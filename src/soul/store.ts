import fs from "node:fs/promises";
import path from "node:path";

export async function readSoul(dataDir: string): Promise<string> {
  try {
    return (await fs.readFile(path.join(dataDir, "SOUL.md"), "utf8")).trim();
  } catch {
    return "";
  }
}

export async function listPersonalities(dataDir: string): Promise<string[]> {
  const root = path.join(dataDir, "personalities");
  try {
    const names = await fs.readdir(root);
    return names
      .filter((n) => n.endsWith(".md"))
      .map((n) => n.replace(/\.md$/, ""))
      .sort();
  } catch {
    return [];
  }
}

export async function readPersonality(
  dataDir: string,
  name: string,
): Promise<string> {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return "";
  try {
    return (
      await fs.readFile(path.join(dataDir, "personalities", `${safe}.md`), "utf8")
    ).trim();
  } catch {
    return "";
  }
}

export async function buildSoulBlock(
  dataDir: string,
  personalityName?: string,
): Promise<string> {
  const parts: string[] = [];
  const soul = await readSoul(dataDir);
  if (soul) parts.push(`=== SOUL.md ===\n${soul}`);
  if (personalityName) {
    const p = await readPersonality(dataDir, personalityName);
    if (p) parts.push(`=== PERSONALITY: ${personalityName} ===\n${p}`);
  }
  try {
    const ctx = await fs.readFile(path.join(dataDir, "CONTEXT.md"), "utf8");
    if (ctx.trim()) parts.push(`=== CONTEXT.md ===\n${ctx.trim()}`);
  } catch {
    // optional
  }
  return parts.join("\n\n");
}

export async function ensureSoulLayout(dataDir: string): Promise<void> {
  await fs.mkdir(path.join(dataDir, "personalities"), { recursive: true });
  const soul = path.join(dataDir, "SOUL.md");
  try {
    await fs.access(soul);
  } catch {
    await fs.writeFile(
      soul,
      "# SOUL\n\nYou are a helpful Discord-connected Cursor agent.\n",
      "utf8",
    );
  }
}
