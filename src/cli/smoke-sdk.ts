/**
 * Optional live SDK smoke test. Requires CURSOR_API_KEY.
 * Skips cleanly when the key is absent (CI / offline).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureMemoryLayout, memoryList } from "../memory/store.js";
import { ensureSkillsLayout } from "../skills/store.js";
import { openAgent, runUserTurn } from "../agent/session.js";
import { runPostTurnReview } from "../agent/review.js";

async function main() {
  const key = process.env.CURSOR_API_KEY?.trim();
  if (!key) {
    console.log("smoke:sdk SKIP (CURSOR_API_KEY not set)");
    return;
  }

  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cda-sdk-"));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cda-cwd-"));
  await ensureMemoryLayout(dataDir);
  await ensureSkillsLayout(dataDir);
  await fs.writeFile(path.join(cwd, "README.md"), "# smoke\n", "utf8");

  const { agent } = await openAgent({
    apiKey: key,
    modelId: process.env.CURSOR_MODEL?.trim() || "composer-2.5",
    modelFast: process.env.CURSOR_MODEL_FAST?.trim().toLowerCase() === "true",
    dataDir,
    agentCwd: cwd,
  });

  try {
    const { text } = await runUserTurn(
      agent,
      dataDir,
      'Using the memory MCP tool only, add to target=memory the exact text "smoke-ok". Then reply with DONE.',
      true,
      { operatorId: "smoke-user" },
    );
    console.log("assistant:", text.slice(0, 500));

    const review = await runPostTurnReview(agent);
    console.log("review:", review);

    const listed = await memoryList(dataDir, "memory");
    console.log("memory entries:", listed.entries);
    if (!listed.entries.some((e) => e.includes("smoke-ok"))) {
      console.warn("warning: smoke-ok not found in memory (model may have ignored tools)");
    }
    console.log("smoke:sdk OK agentId=", agent.agentId);
  } finally {
    await agent.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
