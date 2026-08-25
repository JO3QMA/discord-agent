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

  await patchSkill(dataDir, "hello-world", "milk", "oat milk", "NOTES.md");
  const patchedNotes = await viewSkill(dataDir, "hello-world", "NOTES.md");
  assert(patchedNotes.content.includes("oat milk"), "patch NOTES.md");

  let threw = false;
  try {
    await viewSkill(dataDir, "hello-world", "../MEMORY.md");
  } catch {
    threw = true;
  }
  assert(threw, "path traversal rejected");

  threw = false;
  try {
    await writeSkillFile(dataDir, "hello-world", "SKILL.md", "nope");
  } catch {
    threw = true;
  }
  assert(threw, "skill_write_file cannot clobber SKILL.md");

  await deleteSkill(dataDir, "hello-world");
  assert((await listSkills(dataDir)).length === 0, "skill deleted");

  console.log("check:memory OK", dataDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
