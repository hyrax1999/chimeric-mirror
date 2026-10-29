import { publicBytes } from './content';

export function localServerTool(tool: any): any | undefined {
  if (tool.name === 'web_search' && tool.type?.startsWith('web_search_')) return {
    name: tool.name, description: 'Search the public web. Return source titles, URLs and snippets for citation. Use focused queries.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  };
  if (tool.name === 'web_fetch' && tool.type?.startsWith('web_fetch_')) return {
    name: tool.name, description: 'Read a public web page by URL. Returns extracted text and the source URL.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  };
}
function decode(s: string) { return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
export function pageText(html: string) {
  return decode(html.replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<\/(?:p|div|h[1-6]|li|article|section)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n')).trim();
}
export async function executeServerTool(name: string, args: any, searchUrl?: string, signal?: AbortSignal) {
  if (name === 'web_fetch') {
    if (typeof args.url !== 'string') throw new Error('web_fetch requires a URL');
    const bytes = await publicBytes(args.url, signal);
    if (bytes.subarray(0, 4).toString() === '%PDF') throw new Error('Download this PDF with the native document tools so page content can be extracted.');
    return { url: args.url, text: pageText(bytes.toString('utf8')).slice(0, 100_000), truncated: bytes.length > 100_000 };
  }
  if (name === 'web_search') {
    if (typeof args.query !== 'string' || !args.query.trim()) throw new Error('web_search requires a query');
    if (searchUrl) {
      const url = new URL(searchUrl); url.searchParams.set('q', args.query); url.searchParams.set('format', 'json');
      const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error('SearXNG returned HTTP ' + response.status);
      const doc = await response.json() as any;
      return { query: args.query, results: (doc.results ?? []).slice(0, 10).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content })) };
    }
    const html = (await publicBytes('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(args.query), signal)).toString();
    const results = [...html.matchAll(/<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].slice(0, 10).map(m => {
      const link = new URL(decode(m[1]), 'https://duckduckgo.com');
      return { title: pageText(m[2]), url: link.searchParams.get('uddg') ?? link.href };
    });
    if (!results.length) throw new Error('Public search returned no parseable results. Configure searchUrl with a SearXNG JSON endpoint if the public service requires a challenge.');
    return { query: args.query, results };
  }
  throw new Error('unsupported local server tool: ' + name);
}
