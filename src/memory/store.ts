import fs from "node:fs/promises";
import path from "node:path";
import { dataPaths } from "../config.js";

export const MEMORY_CHAR_LIMIT = 2200;
export const USER_CHAR_LIMIT = 1375;
export const ENTRY_SEP = "§";

export type MemoryTarget = "memory" | "user";

type StoreState = {
  entries: string[];
};

function limitFor(target: MemoryTarget): number {
  return target === "memory" ? MEMORY_CHAR_LIMIT : USER_CHAR_LIMIT;
}

function fileFor(dataDir: string, target: MemoryTarget): string {
  const p = dataPaths(dataDir);
  return target === "memory" ? p.memoryFile : p.userFile;
}

function serialize(entries: string[]): string {
  return entries.join(ENTRY_SEP);
}

function parse(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(ENTRY_SEP)
    .map((e) => e.trim())
    .filter(Boolean);
}

function usageHeader(target: MemoryTarget, used: number): string {
  const limit = limitFor(target);
  const label = target === "memory" ? "MEMORY (your personal notes)" : "USER PROFILE";
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return `${label} [${pct}% — ${used}/${limit} chars]`;
}

export async function ensureMemoryLayout(dataDir: string): Promise<void> {
  const p = dataPaths(dataDir);
  await fs.mkdir(p.memoriesDir, { recursive: true });
  await fs.mkdir(p.skillsDir, { recursive: true });
  for (const f of [p.memoryFile, p.userFile]) {
    try {
      await fs.access(f);
    } catch {
      await fs.writeFile(f, "", "utf8");
    }
  }
}

async function readStore(dataDir: string, target: MemoryTarget): Promise<StoreState> {
  const raw = await fs.readFile(fileFor(dataDir, target), "utf8");
  return { entries: parse(raw) };
}

async function writeStore(
  dataDir: string,
  target: MemoryTarget,
  entries: string[],
): Promise<void> {
  await fs.writeFile(fileFor(dataDir, target), serialize(entries), "utf8");
}

function findUniqueIndex(entries: string[], oldText: string): number | { error: string } {
  const matches = entries
    .map((e, i) => (e.includes(oldText) ? i : -1))
    .filter((i) => i >= 0);
  if (matches.length === 0) return { error: `No entry matched old_text=${JSON.stringify(oldText)}` };
  if (matches.length > 1) {
    return { error: `old_text matched ${matches.length} entries; use a more specific substring` };
  }
  return matches[0]!;
}

export type MemoryResult =
  | { success: true; message: string; usage: string; entries: string[] }
  | {
      success: false;
      error: string;
      usage: string;
      current_entries: string[];
    };

function ok(
  target: MemoryTarget,
  entries: string[],
  message: string,
): MemoryResult {
  const used = serialize(entries).length;
  return {
    success: true,
    message,
    usage: `${used}/${limitFor(target)}`,
    entries,
  };
}

function fail(
  target: MemoryTarget,
  entries: string[],
  error: string,
): MemoryResult {
  const used = serialize(entries).length;
  return {
    success: false,
    error,
    usage: `${used}/${limitFor(target)}`,
    current_entries: entries,
  };
}

export async function memoryAdd(
  dataDir: string,
  target: MemoryTarget,
  content: string,
): Promise<MemoryResult> {
  const text = content.trim();
  if (!text) return fail(target, [], "content is empty");
  const { entries } = await readStore(dataDir, target);
  if (entries.includes(text)) {
    return ok(target, entries, "no duplicate added");
  }
  const next = [...entries, text];
  const used = serialize(next).length;
  const limit = limitFor(target);
  if (used > limit) {
    return fail(
      target,
      entries,
      `${target} at ${serialize(entries).length}/${limit} chars. Adding this entry (${text.length} chars) would exceed the limit. Consolidate with replace/remove, then retry.`,
    );
  }
  await writeStore(dataDir, target, next);
  return ok(target, next, "added");
}

export async function memoryReplace(
  dataDir: string,
  target: MemoryTarget,
  oldText: string,
  content: string,
): Promise<MemoryResult> {
  const text = content.trim();
  if (!text) return fail(target, [], "content is empty");
  const { entries } = await readStore(dataDir, target);
  const idx = findUniqueIndex(entries, oldText);
  if (typeof idx === "object") return fail(target, entries, idx.error);
  const next = [...entries];
  next[idx] = text;
  const used = serialize(next).length;
  const limit = limitFor(target);
  if (used > limit) {
    return fail(
      target,
      entries,
      `replace would exceed limit (${used}/${limit}). Shorten content or remove another entry first.`,
    );
  }
  await writeStore(dataDir, target, next);
  return ok(target, next, "replaced");
}

export async function memoryRemove(
  dataDir: string,
  target: MemoryTarget,
  oldText: string,
): Promise<MemoryResult> {
  const { entries } = await readStore(dataDir, target);
  const idx = findUniqueIndex(entries, oldText);
  if (typeof idx === "object") return fail(target, entries, idx.error);
  const next = entries.filter((_, i) => i !== idx);
  await writeStore(dataDir, target, next);
  return ok(target, next, "removed");
}

export async function memoryList(
  dataDir: string,
  target: MemoryTarget,
): Promise<{ entries: string[]; usage: string; header: string }> {
  const { entries } = await readStore(dataDir, target);
  const used = serialize(entries).length;
  return {
    entries,
    usage: `${used}/${limitFor(target)}`,
    header: usageHeader(target, used),
  };
}

/** Frozen snapshot for session-start injection (Hermes-style). */
export async function buildMemorySnapshot(dataDir: string): Promise<string> {
  const mem = await memoryList(dataDir, "memory");
  const user = await memoryList(dataDir, "user");
  const blocks: string[] = [];
  if (mem.entries.length) {
    blocks.push(
      `══════════════════════════════════════════════\n${mem.header}\n══════════════════════════════════════════════\n${mem.entries.join(ENTRY_SEP)}`,
    );
  }
  if (user.entries.length) {
    blocks.push(
      `══════════════════════════════════════════════\n${user.header}\n══════════════════════════════════════════════\n${user.entries.join(ENTRY_SEP)}`,
    );
  }
  if (!blocks.length) {
    return "(no curated memory yet — use memory MCP tools to save durable facts)";
  }
  return blocks.join("\n\n");
}

export async function formatMemorySummary(dataDir: string): Promise<string> {
  const mem = await memoryList(dataDir, "memory");
  const user = await memoryList(dataDir, "user");
  const lines = [
    `**${mem.header}**`,
    mem.entries.length ? mem.entries.map((e) => `- ${e}`).join("\n") : "_empty_",
    "",
    `**${user.header}**`,
    user.entries.length ? user.entries.map((e) => `- ${e}`).join("\n") : "_empty_",
  ];
  return lines.join("\n");
}

export function memoriesRoot(dataDir: string): string {
  return path.join(dataDir, "memories");
}
