import fs, { type FileHandle } from "node:fs/promises";
import { constants as fsConstants, type Stats } from "node:fs";
import path from "node:path";
import { dataPaths } from "../config.js";

// ponytail: leaf O_NOFOLLOW+fstat; parent-dir TOCTOU needs openat (Node fs has no dirfd open)
const OPEN_NOFOLLOW =
  (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REF_BASENAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}\.md$/;

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

function isRefBasename(file: string): boolean {
  return REF_BASENAME_RE.test(file);
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}

export function assertSkillRelPath(rel: string): string {
  const normalized = rel.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    normalized !== "SKILL.md" &&
    normalized !== "NOTES.md" &&
    !(
      normalized.startsWith("references/") &&
      isRefBasename(normalized.slice("references/".length))
    )
  ) {
    throw new Error(
      `invalid skill path ${JSON.stringify(rel)}; use SKILL.md, NOTES.md, or references/<name>.md`,
    );
  }
  return normalized;
}

async function lstatOrNone(p: string): Promise<Stats | null> {
  try {
    return await fs.lstat(p);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

function assertNotLink(st: Stats | null, p: string): void {
  if (st?.isSymbolicLink()) {
    throw new Error(`symlinks are not allowed in skill paths (${p})`);
  }
}

function mapFollowErr(err: unknown, p: string): never {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ELOOP") {
    throw new Error(`symlinks are not allowed in skill paths (${p})`);
  }
  throw err as Error;
}

async function assertHandleFile(fh: FileHandle, p: string): Promise<void> {
  const st = await fh.stat();
  if (!st.isFile()) {
    throw new Error(`not a regular file (${p})`);
  }
}

async function readPlainFile(file: string): Promise<string> {
  let fh: FileHandle;
  try {
    fh = await fs.open(file, fsConstants.O_RDONLY | OPEN_NOFOLLOW);
  } catch (err) {
    throw mapFollowErr(err, file);
  }
  try {
    await assertHandleFile(fh, file);
    return await fh.readFile("utf8");
  } finally {
    await fh.close();
  }
}

async function writePlainFile(file: string, content: string): Promise<void> {
  let fh: FileHandle;
  try {
    fh = await fs.open(
      file,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_TRUNC |
        OPEN_NOFOLLOW,
    );
  } catch (err) {
    throw mapFollowErr(err, file);
  }
  try {
    await assertHandleFile(fh, file);
    await fh.writeFile(content, "utf8");
  } finally {
    await fh.close();
  }
}

async function resolveSkillRel(
  dataDir: string,
  name: string,
  rel: string,
): Promise<string> {
  assertName(name);
  const normalized = assertSkillRelPath(rel);
  const root = path.resolve(skillDir(dataDir, name));
  const abs = path.resolve(root, normalized);
  const relToRoot = path.relative(root, abs);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    throw new Error("path escapes skill directory");
  }
  const rootSt = await lstatOrNone(root);
  if (!rootSt) throw new Error(`skill ${name} not found`);
  assertNotLink(rootSt, root);
  if (!rootSt.isDirectory()) {
    throw new Error(`not a directory (${root})`);
  }
  const parts = relToRoot.split(path.sep).filter(Boolean);
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]!);
    const st = await lstatOrNone(cur);
    assertNotLink(st, cur);
    if (!st) continue;
    const last = i === parts.length - 1;
    if (last ? !st.isFile() : !st.isDirectory()) {
      throw new Error(`${last ? "not a regular file" : "not a directory"} (${cur})`);
    }
  }
  return abs;
}

export async function listSkillFiles(
  dataDir: string,
  name: string,
): Promise<string[]> {
  assertName(name);
  const dir = skillDir(dataDir, name);
  const out: string[] = ["SKILL.md"];
  const notes = path.join(dir, "NOTES.md");
  try {
    const st = await fs.lstat(notes);
    assertNotLink(st, notes);
    if (st.isFile()) out.push("NOTES.md");
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  const refDir = path.join(dir, "references");
  try {
    const st = await fs.lstat(refDir);
    assertNotLink(st, refDir);
    if (!st.isDirectory()) {
      throw new Error(`not a directory (${refDir})`);
    }
    const refs = await fs.readdir(refDir);
    for (const f of refs.sort()) {
      if (!isRefBasename(f)) continue;
      const fp = path.join(refDir, f);
      const rst = await fs.lstat(fp);
      assertNotLink(rst, fp);
      if (rst.isFile()) out.push(`references/${f}`);
    }
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  return out;
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
  filePath?: string,
): Promise<{ name: string; path: string; content: string; files?: string[] }> {
  const rel = filePath?.trim() ? assertSkillRelPath(filePath) : "SKILL.md";
  const content = await readPlainFile(await resolveSkillRel(dataDir, name, rel));
  if (rel !== "SKILL.md") return { name, path: rel, content };
  return {
    name,
    path: rel,
    content,
    files: await listSkillFiles(dataDir, name),
  };
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
  filePath = "SKILL.md",
): Promise<{ name: string; path: string }> {
  const rel = assertSkillRelPath(filePath);
  const file = await resolveSkillRel(dataDir, name, rel);
  const raw = await readPlainFile(file);
  const count = raw.split(oldText).length - 1;
  if (count === 0) throw new Error("old_text not found");
  if (count > 1) throw new Error("old_text matched multiple times; make it unique");
  await writePlainFile(file, raw.replace(oldText, newText));
  return { name, path: rel };
}

export async function writeSkillFile(
  dataDir: string,
  name: string,
  filePath: string,
  content: string,
): Promise<{ name: string; path: string }> {
  const rel = assertSkillRelPath(filePath);
  if (rel === "SKILL.md") {
    throw new Error("use skill_create or skill_patch for SKILL.md");
  }
  const file = await resolveSkillRel(dataDir, name, rel);
  const parent = path.dirname(file);
  const parentSt = await lstatOrNone(parent);
  if (!parentSt) {
    await fs.mkdir(parent);
  }
  const after = await lstatOrNone(parent);
  assertNotLink(after, parent);
  if (!after?.isDirectory()) {
    throw new Error(`not a directory (${parent})`);
  }
  const dest = await lstatOrNone(file);
  assertNotLink(dest, file);
  if (dest && !dest.isFile()) {
    throw new Error(`not a regular file (${file})`);
  }
  await writePlainFile(file, content);
  return { name, path: rel };
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
