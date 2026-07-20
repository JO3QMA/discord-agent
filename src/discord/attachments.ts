import fs from "node:fs/promises";
import path from "node:path";
import type { Attachment, Message } from "discord.js";

const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export type PreparedAttachments = {
  promptExtra: string;
  images: Array<{ data: string; mimeType: string }>;
  savedPaths: string[];
};

function mimeFor(name: string, contentType?: string | null): string {
  if (contentType?.startsWith("image/")) return contentType;
  const ext = path.extname(name).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return contentType || "application/octet-stream";
}

async function download(att: Attachment, dest: string): Promise<Buffer> {
  if (att.size > MAX_BYTES) {
    throw new Error(`attachment too large (${att.size} > ${MAX_BYTES})`);
  }
  const res = await fetch(att.url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
  return buf;
}

export async function prepareMessageAttachments(
  message: Message,
  agentCwd: string,
): Promise<PreparedAttachments> {
  const out: PreparedAttachments = { promptExtra: "", images: [], savedPaths: [] };
  if (!message.attachments.size) return out;
  const dir = path.join(agentCwd, "attachments", message.id);
  await fs.mkdir(dir, { recursive: true });
  const notes: string[] = [];
  for (const att of message.attachments.values()) {
    const safe = att.name.replace(/[^\w.\-]+/g, "_") || "file";
    const dest = path.join(dir, safe);
    try {
      const buf = await download(att, dest);
      out.savedPaths.push(dest);
      const ext = path.extname(safe).toLowerCase();
      const mime = mimeFor(safe, att.contentType);
      if (IMAGE_EXT.has(ext) || mime.startsWith("image/")) {
        out.images.push({ data: buf.toString("base64"), mimeType: mime });
        notes.push(`image saved: ${dest}`);
      } else {
        notes.push(`file saved: ${dest} (${mime}, ${buf.length} bytes)`);
      }
    } catch (err) {
      notes.push(`skipped ${safe}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (notes.length) {
    out.promptExtra = `\n\n[Attachments]\n${notes.join("\n")}`;
  }
  return out;
}

export function isVoiceAttachment(att: Attachment): boolean {
  const mime = att.contentType ?? "";
  if (mime.startsWith("audio/")) return true;
  const ext = path.extname(att.name).toLowerCase();
  return [".ogg", ".mp3", ".wav", ".m4a", ".webm"].includes(ext);
}
