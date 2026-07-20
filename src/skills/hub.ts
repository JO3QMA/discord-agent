import fs from "node:fs/promises";
import path from "node:path";
import { createSkill, listSkills } from "./store.js";

function assertSafeName(name: string): string {
  const n = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (!n || n.length > 64) throw new Error("invalid skill name");
  return n;
}

/** Install skill from a raw SKILL.md URL or local file path. */
export async function installSkillFromSource(
  dataDir: string,
  source: string,
  nameHint?: string,
): Promise<{ name: string; path: string }> {
  let raw: string;
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    raw = await res.text();
  } else {
    raw = await fs.readFile(path.resolve(source), "utf8");
  }

  let name = nameHint?.trim() || "";
  let description = "imported skill";
  let body = raw;
  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3);
    if (end > 0) {
      const fm = raw.slice(3, end);
      const nm = /^name:\s*(.+)$/m.exec(fm);
      const dm = /^description:\s*(.+)$/m.exec(fm);
      if (nm) name = nm[1]!.trim().replace(/^["']|["']$/g, "");
      if (dm) description = dm[1]!.trim().replace(/^["']|["']$/g, "").slice(0, 60);
      body = raw.slice(end + 4).trim();
    }
  }
  name = assertSafeName(name || `skill-${Date.now().toString(36)}`);
  const existing = await listSkills(dataDir);
  if (existing.some((s) => s.name === name)) {
    throw new Error(`skill ${name} already exists`);
  }
  return createSkill(dataDir, name, description.slice(0, 60), body);
}
