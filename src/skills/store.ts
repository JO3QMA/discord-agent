import fs from "node:fs/promises";
import path from "node:path";
import { dataPaths } from "../config.js";

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type SkillMeta = {
  name: string;
  description: string;
  path: string;
};

function skillDir(dataDir: string, name: string): string {
  return path.join(dataPaths(dataDir).skillsDir, name);
}

function skillFile(dataDir: string, name: string): string {
  return path.join(skillDir(dataDir, name), "SKILL.md");
}

function assertName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `invalid skill name ${JSON.stringify(name)}; use [a-z0-9][a-z0-9_-]{0,63}`,
    );
  }
}

function assertSafeName(name: string): string {
  const n = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (!n || n.length > 64) throw new Error("invalid skill name");
  return n;
}

function parseFrontmatter(
  raw: string,
): { name?: string; description?: string; body: string } {
  if (!raw.startsWith("---")) return { body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { body: raw };
  const fm = raw.slice(3, end);
  const nm = /^name:\s*(.+)$/m.exec(fm);
  const dm = /^description:\s*(.+)$/m.exec(fm);
  return {
    name: nm?.[1]?.trim().replace(/^["']|["']$/g, ""),
    description: dm?.[1]?.trim().replace(/^["']|["']$/g, ""),
    body: raw.slice(end + 4).trim(),
  };
}

export async function ensureSkillsLayout(dataDir: string): Promise<void> {
  await fs.mkdir(dataPaths(dataDir).skillsDir, { recursive: true });
}

export async function listSkills(dataDir: string): Promise<SkillMeta[]> {
  const root = dataPaths(dataDir).skillsDir;
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return [];
  }
  const out: SkillMeta[] = [];
  for (const name of names) {
    const file = skillFile(dataDir, name);
    try {
      const raw = await fs.readFile(file, "utf8");
      const fm = parseFrontmatter(raw);
      out.push({
        name,
        description: fm.description?.slice(0, 60) || "(no description)",
        path: file,
      });
    } catch {
      // skip non-skill dirs
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function viewSkill(
  dataDir: string,
  name: string,
): Promise<{ name: string; content: string }> {
  assertName(name);
  const content = await fs.readFile(skillFile(dataDir, name), "utf8");
  return { name, content };
}

export async function createSkill(
  dataDir: string,
  name: string,
  description: string,
  body: string,
): Promise<{ name: string; path: string }> {
  assertName(name);
  const desc = description.trim();
  if (!desc) throw new Error("description is required");
  if (desc.length > 60) {
    throw new Error("description must be ≤60 characters");
  }
  const dir = skillDir(dataDir, name);
  const file = skillFile(dataDir, name);
  try {
    await fs.access(file);
    throw new Error(`skill ${name} already exists`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      if (err instanceof Error && err.message.includes("already exists")) throw err;
      throw err;
    }
  }
  await fs.mkdir(dir, { recursive: true });
  const content = `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body.trim()}\n`;
  await fs.writeFile(file, content, "utf8");
  return { name, path: file };
}

export async function patchSkill(
  dataDir: string,
  name: string,
  oldText: string,
  newText: string,
): Promise<{ name: string; path: string }> {
  assertName(name);
  const file = skillFile(dataDir, name);
  const raw = await fs.readFile(file, "utf8");
  const count = raw.split(oldText).length - 1;
  if (count === 0) throw new Error("old_text not found");
  if (count > 1) throw new Error("old_text matched multiple times; make it unique");
  await fs.writeFile(file, raw.replace(oldText, newText), "utf8");
  return { name, path: file };
}

export async function deleteSkill(
  dataDir: string,
  name: string,
): Promise<{ name: string }> {
  assertName(name);
  const dir = skillDir(dataDir, name);
  await fs.rm(dir, { recursive: true, force: true });
  return { name };
}

export async function formatSkillsSummary(dataDir: string): Promise<string> {
  const skills = await listSkills(dataDir);
  if (!skills.length) return "_no skills_";
  return skills.map((s) => `- **${s.name}**: ${s.description}`).join("\n");
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

  const fm = parseFrontmatter(raw);
  let name = nameHint?.trim() || fm.name || "";
  const description = (fm.description || "imported skill").slice(0, 60);
  const body = fm.body;
  name = assertSafeName(name || `skill-${Date.now().toString(36)}`);
  const existing = await listSkills(dataDir);
  if (existing.some((s) => s.name === name)) {
    throw new Error(`skill ${name} already exists`);
  }
  return createSkill(dataDir, name, description, body);
}
