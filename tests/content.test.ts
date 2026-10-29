import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContentReader } from "../src/content";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function reader() {
  const dir = mkdtempSync(join(tmpdir(), "chimeric-content-"));
  return { value: new ContentReader(dir), close: () => rmSync(dir, { recursive: true, force: true }) };
}

test("image content validates its declared media type before forwarding bytes", async () => {
  const r = reader();
  try {
    const content = await r.value.content({ type: "image", source: { type: "base64", media_type: "image/png", data: png } }, true);
    expect(content[0].mimeType).toBe("image/png");
    await expect(r.value.content({ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }, true)).rejects.toThrow("do not match");
  } finally { r.close(); }
});

test("base64 and PDF inputs reject malformed or oversized representations", async () => {
  const r = reader();
  try {
    await expect(r.value.sourceBytes({ type: "base64", data: "not-base64" })).rejects.toThrow("invalid base64");
    await expect(r.value.sourceBytes({ type: "base64", data: "A".repeat(4 * Math.ceil(50 * 1024 * 1024 / 3) + 4) })).rejects.toThrow("50 MiB");
    await expect(r.value.content({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from("plain text").toString("base64") } }, false)).rejects.toThrow("valid PDF header");
  } finally { r.close(); }
});

test("valid WebP remains accepted and truncated containers fail", async () => {
  const r = reader();
  const webp = "UklGRi4AAABXRUJQVlA4ICIAAABwAQCdASoBAAEAAUAmJZQCdAFAAAD++ldotRJUvJ+iMAAA";
  try {
    const content = await r.value.content({ type: "image", source: { type: "base64", media_type: "image/webp", data: webp } }, true);
    expect(content[0].mimeType).toBe("image/webp");
    await expect(r.value.content({ type: "image", source: { type: "base64", media_type: "image/webp", data: Buffer.from(webp, "base64").subarray(0, 20).toString("base64") } }, true)).rejects.toThrow("do not match");
  } finally { r.close(); }
});
