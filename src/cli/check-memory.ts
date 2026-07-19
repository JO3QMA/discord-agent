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

  await deleteSkill(dataDir, "hello-world");
  assert((await listSkills(dataDir)).length === 0, "skill deleted");

  console.log("check:memory OK", dataDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
