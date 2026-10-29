import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { bannedHost } from "./registry";

function privateAddress(ip: string) {
  if (ip.includes(':')) return !/^[23][0-9a-f]{3}:/i.test(ip) || /^2002:|^2001:(?:0{0,3}[0-9a-f]{1,2}|db8):/i.test(ip);
  const [a,b,c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
    || a === 100 && b >= 64 && b <= 127 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2))
    || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113;
}

export async function publicBytes(address: string, signal?: AbortSignal, redirects = 0): Promise<Buffer> {
  const u = new URL(address);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || bannedHost(u.hostname)) throw new Error("unsupported public document URL");
  const addresses = await lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some(a => privateAddress(a.address))) throw new Error("public document URL resolves to a private network");
  return await new Promise((done, fail) => {
    const selected = addresses.find(a => a.family === 4) ?? addresses[0];
    const request = (u.protocol === "https:" ? https : http).get(u, {
      signal, timeout: 30_000,
      lookup: (_host: any, options: any, callback: any) => options?.all
        ? callback(null, [selected]) : callback(null, selected.address, selected.family),
      headers: { "user-agent": "Chimeric-LocalProvider/0.1" },
    }, response => {
      if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirects >= 3) return fail(new Error("too many document redirects"));
        publicBytes(new URL(response.headers.location, u).href, signal, redirects + 1).then(done, fail); return;
      }
      if (response.statusCode !== 200) { response.resume(); fail(new Error("document fetch returned HTTP " + response.statusCode)); return; }
      let size = 0; const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_SOURCE_BYTES) response.destroy(new Error("document exceeds 50 MiB"));
        else chunks.push(chunk);
      });
      response.on("end", () => done(Buffer.concat(chunks)));
      response.on("error", fail);
    });
    request.on("timeout", () => request.destroy(new Error("document fetch timed out")));
    request.on("error", fail);
  });
}

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_CONVERTER_OUTPUT = 20 * 1024 * 1024;

function validBase64(value: string) {
  if (!value.length || value.length % 4 !== 0) return false;
  const body = value.replace(/={1,2}$/, "");
  return /^[A-Za-z0-9+/]+$/.test(body);
}

function validateImage(bytes: Buffer, mediaType: string) {
  // These are representation guards. Full decode and decompression limits
  // belong to the managed converter worker, which remains a release gate.
  const png = bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.readUInt32BE(8) === 13 && bytes.subarray(12, 16).toString() === "IHDR"
    && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(bytes.length - 12) === 0
    && bytes.subarray(bytes.length - 8, bytes.length - 4).toString() === "IEND";
  const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  const gif = bytes.length >= 14 && (bytes.subarray(0, 6).toString() === "GIF87a" || bytes.subarray(0, 6).toString() === "GIF89a") && bytes.readUInt16LE(6) > 0 && bytes.readUInt16LE(8) > 0 && bytes.at(-1) === 0x3b;
  const webp = bytes.length >= 20 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.readUInt32LE(4) === bytes.length - 8
    && bytes.subarray(8, 12).toString() === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(bytes.subarray(12, 16).toString());
  const valid = mediaType === "image/png" ? png : mediaType === "image/jpeg" ? jpeg : mediaType === "image/gif" ? gif : mediaType === "image/webp" ? webp : false;
  if (!valid) throw new Error("image bytes do not match the declared image media type");
}

function converter(name: string) {
  const path = Bun.which(name);
  if (!path) throw new Error(`required document converter is unavailable: ${name}`);
  return path;
}

async function processText(argv: string[], signal?: AbortSignal) {
  signal?.throwIfAborted();
  const env: Record<string, string> = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "TMPDIR"]) if (process.env[key]) env[key] = process.env[key]!;
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", env });
  const stop = () => child.kill("SIGKILL"); signal?.addEventListener("abort", stop, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; stop(); }, 60_000);
  try {
    const readBounded = async (stream: ReadableStream<Uint8Array>, label: string) => {
      const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > MAX_CONVERTER_OUTPUT) { stop(); throw new Error(`document converter ${label} output exceeds 20 MiB`); } chunks.push(next.value); } }
      finally { reader.releaseLock(); }
      return new TextDecoder().decode(Buffer.concat(chunks.map(x => Buffer.from(x))));
    };
    const [code, text, error] = await Promise.all([child.exited, readBounded(child.stdout, "stdout"), readBounded(child.stderr, "stderr")]);
    if (signal?.aborted) throw signal.reason;
    if (timedOut) throw new Error("document conversion timed out after 60 seconds");
    if (code !== 0) throw new Error("document conversion failed: " + error.slice(0, 300));
    return text;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); if (child.exitCode === null) { stop(); await child.exited; } }
}

export class ContentReader {
  constructor(readonly directory: string) { mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  async sourceBytes(source: any, signal?: AbortSignal): Promise<Buffer> {
    if (source?.type === "base64" && typeof source.data === "string") {
      if (source.data.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4) throw new Error("document exceeds 50 MiB");
      if (!validBase64(source.data)) throw new Error("content source contains invalid base64");
      const bytes = Buffer.from(source.data, "base64");
      if (bytes.length > MAX_SOURCE_BYTES) throw new Error("document exceeds 50 MiB");
      return bytes;
    }
    if (source?.type === "url" && typeof source.url === "string") return publicBytes(source.url, signal);
    throw new Error("content source must provide base64 bytes or a public URL");
  }
  async content(block: any, images: boolean, signal?: AbortSignal): Promise<any[]> {
    if (typeof block === "string") return [{ type: "text", text: block }];
    if (block?.type === "text") return [{ type: "text", text: String(block.text ?? "") }];
    if (block?.type === "image") {
      if (!images) throw new Error("selected model has no verified image capability; choose a vision-capable model");
      const bytes = await this.sourceBytes(block.source, signal);
      const mimeType = block.source.media_type ?? "image/png";
      validateImage(bytes, mimeType);
      return [{ type: "image", data: bytes.toString("base64"), mimeType }];
    }
    if (block?.type === "document") {
      const source = block.source;
      if (source?.type === "text") return [{ type: "text", text: String(source.data ?? "") }];
      if (source?.media_type && source.media_type !== "application/pdf") throw new Error("unsupported document media type: " + source.media_type);
      const bytes = await this.sourceBytes(source, signal);
      if (bytes.length < 5 || bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("document bytes do not contain a valid PDF header");
      const stage = mkdtempSync(join(this.directory, "pdf-"));
      try {
        const file = join(stage, "document.pdf"); writeFileSync(file, bytes, { mode: 0o600 });
        const text = await processText([converter("pdftotext"), "-layout", file, "-"], signal);
        const result: any[] = [{ type: "text", text: (block.title ? `Document: ${block.title}\n` : "") + text }];
        if (images) {
          const info = await processText([converter("pdfinfo"), file], signal);
          const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
          if (!pages || pages > 100) throw new Error("PDF visual input requires a document containing 1–100 pages; select a page range with the native PDF tools");
          await processText([converter("pdftoppm"), "-scale-to", "1024", "-png", file, join(stage, "page")], signal);
          for (const path of readdirSync(stage).filter(x => /^page-.*\.png$/.test(x)).sort()) {
            const pageBytes = readFileSync(join(stage, path)); validateImage(pageBytes, "image/png");
            result.push({ type: "text", text: "PDF page " + path.match(/(\d+)\.png$/)?.[1] });
            result.push({ type: "image", mimeType: "image/png", data: pageBytes.toString("base64") });
          }
        }
        return result;
      } finally { rmSync(stage, { recursive: true, force: true }); }
    }
    throw new Error("unsupported native content block: " + String(block?.type));
  }
}
