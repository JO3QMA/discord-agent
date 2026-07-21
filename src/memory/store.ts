import fs from "node:fs/promises";
import path from "node:path";
import { dataPaths } from "../config.js";

export const MEMORY_CHAR_LIMIT = 2200;
export const USER_CHAR_LIMIT = 1375;
export const ENTRY_SEP = "§";

export type MemoryTarget = "memory" | "user";

function limitFor(target: MemoryTarget): number {
  return target === "memory" ? MEMORY_CHAR_LIMIT : USER_CHAR_LIMIT;
}

function operatorUserFile(dataDir: string, operatorId: string): string {
  return path.join(dataDir, "memories", "operators", operatorId, "USER.md");
}

function fileFor(
  dataDir: string,
  target: MemoryTarget,
  operatorId?: string,
): string {
  const p = dataPaths(dataDir);
  if (target === "memory") return p.memoryFile;
  if (!operatorId) {
    throw new Error("operatorId is required for USER (Operator-scoped profile)");
  }
  return operatorUserFile(dataDir, operatorId);
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
  await fs.mkdir(path.join(p.memoriesDir, "operators"), { recursive: true });
  try {
    await fs.access(p.memoryFile);
  } catch {
    await fs.writeFile(p.memoryFile, "", "utf8");
  }
}

async function readStore(
  dataDir: string,
  target: MemoryTarget,
  operatorId?: string,
): Promise<string[]> {
  if (target === "user" && operatorId) {
    const file = fileFor(dataDir, target, operatorId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, "", "utf8");
    }
  }
  const raw = await fs.readFile(fileFor(dataDir, target, operatorId), "utf8");
  return parse(raw);
}

async function writeStore(
  dataDir: string,
  target: MemoryTarget,
  entries: string[],
  operatorId?: string,
): Promise<void> {
  const file = fileFor(dataDir, target, operatorId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, serialize(entries), "utf8");
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
  operatorId?: string,
): Promise<MemoryResult> {
  const text = content.trim();
  if (!text) return fail(target, [], "content is empty");
  try {
    const entries = await readStore(dataDir, target, operatorId);
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
    await writeStore(dataDir, target, next, operatorId);
    return ok(target, next, "added");
  } catch (err) {
    return fail(target, [], err instanceof Error ? err.message : String(err));
  }
}

export async function memoryReplace(
  dataDir: string,
  target: MemoryTarget,
  oldText: string,
  content: string,
  operatorId?: string,
): Promise<MemoryResult> {
  const text = content.trim();
  if (!text) return fail(target, [], "content is empty");
  try {
    const entries = await readStore(dataDir, target, operatorId);
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
    await writeStore(dataDir, target, next, operatorId);
    return ok(target, next, "replaced");
  } catch (err) {
    return fail(target, [], err instanceof Error ? err.message : String(err));
  }
}

export async function memoryRemove(
  dataDir: string,
  target: MemoryTarget,
  oldText: string,
  operatorId?: string,
): Promise<MemoryResult> {
  try {
    const entries = await readStore(dataDir, target, operatorId);
    const idx = findUniqueIndex(entries, oldText);
    if (typeof idx === "object") return fail(target, entries, idx.error);
    const next = entries.filter((_, i) => i !== idx);
    await writeStore(dataDir, target, next, operatorId);
    return ok(target, next, "removed");
  } catch (err) {
    return fail(target, [], err instanceof Error ? err.message : String(err));
  }
}

export async function memoryList(
  dataDir: string,
  target: MemoryTarget,
  operatorId?: string,
): Promise<{ entries: string[]; usage: string; header: string }> {
  const entries = await readStore(dataDir, target, operatorId);
  const used = serialize(entries).length;
  return {
    entries,
    usage: `${used}/${limitFor(target)}`,
    header: usageHeader(target, used),
  };
}

/** Frozen MEMORY snapshot for session-start injection (USER is per-turn via operatorBlock). */
export async function buildMemorySnapshot(dataDir: string): Promise<string> {
  const mem = await memoryList(dataDir, "memory");
  if (!mem.entries.length) {
    return "(no curated memory yet — use memory MCP tools to save durable facts)";
  }
  return `══════════════════════════════════════════════\n${mem.header}\n══════════════════════════════════════════════\n${mem.entries.join(ENTRY_SEP)}`;
}

export async function formatMemorySummary(
  dataDir: string,
  operatorId: string,
): Promise<string> {
  const mem = await memoryList(dataDir, "memory");
  const user = await memoryList(dataDir, "user", operatorId);
  const lines = [
    `**${mem.header}**`,
    mem.entries.length ? mem.entries.map((e) => `- ${e}`).join("\n") : "_empty_",
    "",
    `**${user.header}** (Operator \`${operatorId}\`)`,
    user.entries.length ? user.entries.map((e) => `- ${e}`).join("\n") : "_empty_",
  ];
  return lines.join("\n");
}
