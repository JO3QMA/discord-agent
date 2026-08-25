import fs, { type FileHandle } from "node:fs/promises";
import { constants as fsConstants, type Stats } from "node:fs";
import path from "node:path";
import { dataPaths } from "../config.js";

// ponytail: Linux /proc/self/fd is openat without a native binding
const writeTails = new Map<string, Promise<unknown>>();

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

function noFollow(): number {
  const follow = fsConstants.O_NOFOLLOW;
  const dir = fsConstants.O_DIRECTORY;
  if (!follow || !dir) {
    throw new Error("O_NOFOLLOW and O_DIRECTORY are required for skill file I/O");
  }
  return follow | (fsConstants.O_NONBLOCK ?? 0);
}

async function openNoFollow(p: string, flags: number): Promise<FileHandle> {
  try {
    return await fs.open(p, flags | noFollow());
  } catch (err) {
    throw mapFollowErr(err, p);
  }
}

async function assertHandleFile(fh: FileHandle, p: string): Promise<void> {
  const st = await fh.stat();
  if (!st.isFile()) {
    throw new Error(`not a regular file (${p})`);
  }
}

async function withSkillParent<T>(
  dataDir: string,
  name: string,
  rel: string,
  mkdirRefs: boolean,
  fn: (dir: FileHandle, part: string) => Promise<T>,
): Promise<T> {
  if (process.platform !== "linux") {
    throw new Error("skill file I/O requires Linux (/proc/self/fd)");
  }
  assertName(name);
  const parts = assertSkillRelPath(rel).split("/").filter(Boolean);
  if (!parts.length) throw new Error("empty skill path");
  const root = path.resolve(skillDir(dataDir, name));
  let dir: FileHandle | null = await openNoFollow(
    root,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY,
  );
  try {
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      const child = `/proc/self/fd/${dir.fd}/${part}`;
      let next: FileHandle;
      try {
        next = await openNoFollow(
          child,
          fsConstants.O_RDONLY | fsConstants.O_DIRECTORY,
        );
      } catch (err) {
        if (!(mkdirRefs && part === "references" && isMissing(err))) throw err;
        try {
          await fs.mkdir(child);
        } catch (mkdirErr) {
          if ((mkdirErr as NodeJS.ErrnoException).code !== "EEXIST") {
            throw mapFollowErr(mkdirErr, child);
          }
        }
        next = await openNoFollow(
          child,
          fsConstants.O_RDONLY | fsConstants.O_DIRECTORY,
        );
      }
      try {
        await dir.close();
      } catch (closeErr) {
        await next.close().catch(() => {});
        dir = null;
        throw closeErr;
      }
      dir = next;
    }
    return await fn(dir, parts[parts.length - 1]!);
  } finally {
    await dir?.close().catch(() => {});
  }
}

async function readSkillRel(
  dataDir: string,
  name: string,
  rel: string,
): Promise<string> {
  return withSkillParent(dataDir, name, rel, false, async (dir, part) => {
    const fh = await openNoFollow(
      `/proc/self/fd/${dir.fd}/${part}`,
      fsConstants.O_RDONLY,
    );
    try {
      await assertHandleFile(fh, rel);
      return await fh.readFile("utf8");
    } finally {
      await fh.close();
    }
  });
}

async function writeSkillRel(
  dataDir: string,
  name: string,
  rel: string,
  content: string,
): Promise<void> {
  await withSkillParent(
    dataDir,
    name,
    rel,
    rel.startsWith("references/"),
    async (dir, part) => {
      const tmpName = `.${part}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      const tmpPath = `/proc/self/fd/${dir.fd}/${tmpName}`;
      const destPath = `/proc/self/fd/${dir.fd}/${part}`;
      const fh = await openNoFollow(
        tmpPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      );
      try {
        await assertHandleFile(fh, tmpPath);
        await fh.writeFile(content, "utf8");
        await fh.sync();
      } catch (err) {
        await fh.close().catch(() => {});
        await fs.unlink(tmpPath).catch(() => {});
        throw err;
      }
      await fh.close();
      try {
        await fs.rename(tmpPath, destPath);
      } catch (err) {
        await fs.unlink(tmpPath).catch(() => {});
        throw err;
      }
    },
  );
}

function withSkillWriteLock<T>(
  dataDir: string,
  name: string,
  rel: string,
  fn: () => Promise<T>,
): Promise<T> {
  // ponytail: in-process write lock; flock if two processes share DATA_DIR
  const key = `${path.resolve(dataDir)}\0${name}\0${rel}`;
  const prev = writeTails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  writeTails.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export async function listSkillFiles(
  dataDir: string,
  name: string,
): Promise<string[]> {
  assertName(name);
  const dir = skillDir(dataDir, name);
  const skillMd = path.join(dir, "SKILL.md");
  const sst = await lstatOrNone(skillMd);
  assertNotLink(sst, skillMd);
  if (!sst?.isFile()) {
    throw new Error(`not a regular file (${skillMd})`);
  }
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
  const content = await readSkillRel(dataDir, name, rel);
  if (rel !== "SKILL.md") return { name, path: rel, content };
  let files: string[] | undefined;
  try {
    files = await listSkillFiles(dataDir, name);
  } catch {
    // content already read; listing is best-effort
  }
  return { name, path: rel, content, files };
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
  return withSkillWriteLock(dataDir, name, rel, async () => {
    const raw = await readSkillRel(dataDir, name, rel);
    const count = raw.split(oldText).length - 1;
    if (count === 0) throw new Error("old_text not found");
    if (count > 1) throw new Error("old_text matched multiple times; make it unique");
    await writeSkillRel(dataDir, name, rel, raw.replace(oldText, newText));
    return { name, path: rel };
  });
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
  return withSkillWriteLock(dataDir, name, rel, async () => {
    await writeSkillRel(dataDir, name, rel, content);
    return { name, path: rel };
  });
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
