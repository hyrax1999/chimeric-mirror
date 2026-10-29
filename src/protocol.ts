import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
import type { AssistantMessage, Context, Message, Tool } from "@earendil-works/pi-ai";
import type { ModelEntry } from "./registry";
import { ContentReader } from "./content";

export const zeroUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
export const stopReason = (reason: string) => reason === "toolUse" ? "tool_use" : reason === "length" ? "max_tokens" : "end_turn";
export function normalizeNativeMessage(value:any) {
  const result = JSON.parse(JSON.stringify(value));
  if (!result.content?.some((b:any)=>b.type === 'server_tool_use')) return result;
  const texts = result.content.filter((b:any)=>b.type === 'text');
  if (texts.length < 2) return result;
  const last = result.content.findLastIndex((b:any)=>b.type === 'text');
  result.content = result.content.flatMap((b:any,i:number)=>b.type !== 'text' ? [b] : i === last ? [{type:'text',text:texts.map((t:any)=>t.text).join('\n')}] : []);
  return result;
}

function serverResultText(content: any): string {
  if (Array.isArray(content)) return JSON.stringify(content.map(b => {
    if (b.type === "web_search_result" && b.encrypted_content?.startsWith("local:")) {
      try { return JSON.parse(Buffer.from(b.encrypted_content.slice(6), "base64").toString()); } catch { throw new Error("invalid local search history"); }
    }
    return b;
  }));
  return JSON.stringify(content);
}
function semanticContent(content: any[]) {
  return content.filter(b => ["text", "tool_use", "server_tool_use"].includes(b.type)).map(b => b.type === "text"
    ? { type: "text", text: b.text } : { type: "tool_use", id: b.id, name: b.name, input: b.input });
}
export class ReplayStore {
  private db: Database;
  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS replay (key TEXT PRIMARY KEY, model TEXT NOT NULL, message TEXT NOT NULL, created INTEGER NOT NULL)");
    this.db.query('DELETE FROM replay WHERE created < ?').run(Date.now()-7*24*60*60*1000);
  }
  key(content: any[], model: string) { return createHash("sha256").update(model + "\n" + JSON.stringify(semanticContent(content))).digest("hex"); }
  put(content: any[], model: string, message: AssistantMessage) {
    this.db.query("INSERT OR REPLACE INTO replay VALUES(?,?,?,?)").run(this.key(content, model), model, JSON.stringify(message), Date.now());
    this.db.exec('DELETE FROM replay WHERE key IN (SELECT key FROM replay ORDER BY created DESC LIMIT -1 OFFSET 1000)');
  }
  get(content: any[], model: string): AssistantMessage | undefined {
    const row = this.db.query("SELECT message FROM replay WHERE key=?").get(this.key(content, model)) as any;
    return row ? JSON.parse(row.message) : undefined;
  }
  clear() { this.db.exec('PRAGMA secure_delete=ON; DELETE FROM replay; PRAGMA wal_checkpoint(TRUNCATE)'); }
}

export async function toContext(body: any, model: ModelEntry, reader: ContentReader, replay: ReplayStore, signal?: AbortSignal): Promise<Context> {
  if (!Array.isArray(body.messages)) throw new Error("native messages must be an array");
  const images = model.input.includes("image");
  const messages: Message[] = [];
  const names = new Map<string, string>();
  for (const entry of body.messages) {
    if (!["user", "assistant"].includes(entry.role)) throw new Error("invalid native message role");
    const blocks = typeof entry.content === "string" ? [{ type: "text", text: entry.content }] : entry.content;
    if (!Array.isArray(blocks)) throw new Error("invalid native message content");
    if (entry.role === "assistant") {
      const cached = blocks.some(b => b.type?.endsWith("_tool_result")) ? undefined : replay.get(blocks, model.replayKey??model.qualifiedId);
      if (cached) {
        messages.push(cached);
        for (const item of cached.content) if (item.type === "toolCall") names.set(item.id, item.name);
        continue;
      }
      const content: any[] = [];
      for (const block of blocks) {
        if (block.type === "text") content.push({ type: "text", text: String(block.text ?? "") });
        else if (["tool_use", "server_tool_use"].includes(block.type)) {
          if (!block.id || !block.name || !block.input || typeof block.input !== "object") throw new Error("invalid native tool call");
          names.set(block.id, block.name);
          content.push({ type: "toolCall", id: block.id, name: block.name, arguments: block.input });
        } else if (block.type.endsWith("_tool_result")) {
          const id = block.tool_use_id; const name = names.get(id);
          if (!name) throw new Error("server tool result has no matching call");
          if(content.length) messages.push({ role: "assistant", content: content.splice(0), api: "anthropic-messages", provider: "native-history", model: "native-history", usage: zeroUsage(), stopReason: "toolUse", timestamp: 0 });
          messages.push({ role: "toolResult", toolCallId: id, toolName: name, content: [{type:"text",text:serverResultText(block.content)}], isError: block.is_error === true, timestamp:0 });
        } else if (["thinking", "redacted_thinking"].includes(block.type)) {
          // Foreign private reasoning is retained in the native transcript, and
          // is not replayed as another provider's authenticated reasoning.
        } else if (block.type === "compaction" && typeof block.content === "string") {
          content.push({ type: "text", text: block.content });
        } else throw new Error("unsupported native assistant block: " + block.type);
      }
      if (content.length) messages.push({ role: "assistant", content, api: "anthropic-messages", provider: "native-history", model: "native-history", usage: zeroUsage(), stopReason: content.some(x => x.type === "toolCall") ? "toolUse" : "stop", timestamp: 0 });
    } else {
      const content: any[] = [];
      for (const block of blocks) {
        if (block.type === "tool_result") {
          const result: any[] = [];
          const pieces = typeof block.content === "string" ? [block.content] : block.content ?? [];
          for (const piece of pieces) result.push(...await reader.content(piece, images, signal));
          const name = names.get(block.tool_use_id);
          if (!name) throw new Error("tool result has no matching call: " + block.tool_use_id);
          messages.push({ role: "toolResult", toolCallId: block.tool_use_id, toolName: name, content: result, isError: block.is_error === true, timestamp: 0 });
        } else content.push(...await reader.content(block, images, signal));
      }
      if (content.length) messages.push({ role: "user", content, timestamp: 0 });
    }
  }
  const system = typeof body.system === "string" ? body.system : (body.system ?? []).map((b: any) => {
    if (b.type !== "text") throw new Error("unsupported native system block: " + b.type);
    return b.text;
  }).join("\n");
  const tools: Tool[] = [];
  for (const tool of body.tools ?? []) {
    if (typeof tool.name !== "string" || !tool.input_schema) throw new Error("native server tool requires an OSS implementation: " + (tool.type ?? tool.name));
    tools.push({ name: tool.name, description: tool.description ?? "", parameters: tool.input_schema });
  }
  return { messages, systemPrompt: system, tools };
}

export function toNativeContent(message: AssistantMessage): any[] {
  const blocks: any[] = [];
  for (const block of message.content) {
    if (block.type === "text") blocks.push({ type: "text", text: block.text });
    else if (block.type === "thinking" && !block.redacted) blocks.push({ type: "thinking", thinking: block.thinking, signature: block.thinkingSignature ?? "local-provider-replay" });
    else if (block.type === "toolCall") {
      if (block.argumentsError) throw new Error("provider returned malformed tool arguments");
      blocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.arguments });
    }
  }
  return blocks;
}

export function nativeUsage(message: AssistantMessage) {
  return { input_tokens: message.usage.input, output_tokens: message.usage.output, cache_read_input_tokens: message.usage.cacheRead, cache_creation_input_tokens: message.usage.cacheWrite };
}
export function nativeMessage(message: AssistantMessage, requested: string, id: string) {
  if (["error", "aborted", "deferred"].includes(message.stopReason)) throw new Error(message.errorMessage ?? "provider did not complete a synchronous turn");
  return { id, type: "message", role: "assistant", model: requested, content: toNativeContent(message), stop_reason: stopReason(message.stopReason), stop_sequence: null, usage: nativeUsage(message) };
}

export function toolChoice(body: any): any {
  const choice = body.tool_choice;
  if (!choice || choice.type === "auto") return "auto";
  if (choice.type === "none") return "none";
  if (choice.type === "any") return "required";
  if (choice.type === "tool" && typeof choice.name === "string") return { type: "function", function: { name: choice.name } };
  throw new Error("invalid native tool_choice");
}
