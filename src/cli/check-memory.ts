import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MEMORY_CHAR_LIMIT,
  ensureMemoryLayout,
  memoryAdd,
  memoryList,
  memoryRemove,
  memoryReplace,
} from "../memory/store.js";
import {
  createSkill,
  deleteSkill,
  ensureSkillsLayout,
  listSkills,
  patchSkill,
  viewSkill,
  writeSkillFile,
} from "../skills/store.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function trySymlink(target: string, link: string): Promise<boolean> {
  try {
    await fs.symlink(target, link);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") return false;
    throw err;
  }
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cda-mem-"));
  await ensureMemoryLayout(dataDir);
  await ensureSkillsLayout(dataDir);

  let r = await memoryAdd(dataDir, "memory", "Project uses TypeScript strict mode");
  assert(r.success, "add should succeed");

  r = await memoryAdd(dataDir, "memory", "Project uses TypeScript strict mode");
  assert(r.success && r.message.includes("duplicate"), "duplicate should be no-op");

  r = await memoryReplace(
    dataDir,
    "memory",
    "TypeScript",
    "Project uses TypeScript 5.9 strict mode",
  );
  assert(r.success, "replace should succeed");

  const big = "x".repeat(MEMORY_CHAR_LIMIT);
  r = await memoryAdd(dataDir, "memory", big);
  assert(!r.success, "overflow add should fail");

  r = await memoryRemove(dataDir, "memory", "TypeScript 5.9");
  assert(r.success, "remove should succeed");

  const listed = await memoryList(dataDir, "memory");
  assert(listed.entries.length === 0, "memory should be empty after remove");

  await createSkill(
    dataDir,
    "hello-world",
    "Say hello in one line",
    "# Hello\n\nReply with PONG.",
  );
  const skills = await listSkills(dataDir);
  assert(skills.length === 1 && skills[0]!.name === "hello-world", "skill list");

  await patchSkill(dataDir, "hello-world", "PONG", "PING");
  const viewed = await viewSkill(dataDir, "hello-world");
  assert(viewed.content.includes("PING"), "patch applied");
  assert(viewed.files?.includes("SKILL.md"), "view lists SKILL.md");

  await writeSkillFile(dataDir, "hello-world", "NOTES.md", "# list\n- milk\n");
  const notes = await viewSkill(dataDir, "hello-world", "NOTES.md");
  assert(notes.path === "NOTES.md" && notes.content.includes("milk"), "NOTES.md roundtrip");
  const indexed = await viewSkill(dataDir, "hello-world");
  assert(indexed.files?.includes("NOTES.md"), "SKILL.md view lists NOTES.md");

  await writeSkillFile(
    dataDir,
    "hello-world",
    "references/sites.md",
    "# sites\npark\n",
  );
  const ref = await viewSkill(dataDir, "hello-world", "references/sites.md");
  assert(ref.content.includes("park"), "references/ roundtrip");
  const refIndexed = await viewSkill(dataDir, "hello-world");
  assert(refIndexed.files?.includes("references/sites.md"), "view lists references/");

  await patchSkill(dataDir, "hello-world", "milk", "oat milk", "NOTES.md");
  const patchedNotes = await viewSkill(dataDir, "hello-world", "NOTES.md");
  assert(patchedNotes.content.includes("oat milk"), "patch NOTES.md");

  let threw = false;
  for (const rel of ["../MEMORY.md", "references/../NOTES.md"]) {
    threw = false;
    try {
      await viewSkill(dataDir, "hello-world", rel);
    } catch {
      threw = true;
    }
    assert(threw, `view rejects ${rel}`);
    threw = false;
    try {
      await writeSkillFile(dataDir, "hello-world", rel, "x");
    } catch {
      threw = true;
    }
    assert(threw, `write rejects ${rel}`);
    threw = false;
    try {
      await patchSkill(dataDir, "hello-world", "a", "b", rel);
    } catch {
      threw = true;
    }
    assert(threw, `patch rejects ${rel}`);
  }

  threw = false;
  try {
    await writeSkillFile(dataDir, "hello-world", "SKILL.md", "nope");
  } catch {
    threw = true;
  }
  assert(threw, "skill_write_file cannot clobber SKILL.md");

  const outside = path.join(dataDir, "outside.md");
  await fs.writeFile(outside, "secret\n");
  const notesPath = path.join(dataDir, "skills", "hello-world", "NOTES.md");
  const refDir = path.join(dataDir, "skills", "hello-world", "references");
  await fs.rm(notesPath);
  if (await trySymlink(outside, notesPath)) {
    threw = false;
    try {
      await viewSkill(dataDir, "hello-world", "NOTES.md");
    } catch (err) {
      threw = err instanceof Error && err.message.includes("symlink");
    }
    assert(threw, "NOTES.md symlink rejected");
    assert((await fs.readFile(outside, "utf8")) === "secret\n", "outside.md unchanged");

    await fs.rm(refDir, { recursive: true });
    const evil = path.join(dataDir, "evil");
    await fs.mkdir(evil);
    if (await trySymlink(evil, refDir)) {
      threw = false;
      try {
        await writeSkillFile(dataDir, "hello-world", "references/x.md", "nope");
      } catch {
        threw = true;
      }
      assert(threw, "references/ symlink dir rejected");
      let leaked = true;
      try {
        await fs.access(path.join(evil, "x.md"));
      } catch {
        leaked = false;
      }
      assert(!leaked, "did not write through symlink dir");
    }
  }

  await deleteSkill(dataDir, "hello-world");
  assert((await listSkills(dataDir)).length === 0, "skill deleted");

  console.log("check:memory OK", dataDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
