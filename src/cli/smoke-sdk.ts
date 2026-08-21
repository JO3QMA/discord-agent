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
import { runDetachedReview } from "../agent/review.js";
import { parseBool, parseModelEffort } from "../config.js";

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

  const userText =
    'Using the memory MCP tool only, add to target=memory the exact text "smoke-ok". Then reply with DONE.';
  const { agent } = await openAgent({
    apiKey: key,
    modelId: process.env.CURSOR_MODEL?.trim() || "composer-2.5",
    modelFast: process.env.CURSOR_MODEL_FAST?.trim().toLowerCase() === "true",
    modelEffort: parseModelEffort(process.env.CURSOR_MODEL_EFFORT),
    dataDir,
    agentCwd: cwd,
  });

  try {
    const { text } = await runUserTurn(agent, dataDir, userText, true, {
      operatorId: "smoke-user",
    });
    console.log("assistant:", text.slice(0, 500));

    const conversationId = agent.agentId;
    const review = await runDetachedReview({
      apiKey: key,
      modelId:
        process.env.REVIEW_MODEL?.trim() ||
        process.env.CURSOR_MODEL?.trim() ||
        "composer-2.5",
      modelFast: parseBool(process.env.REVIEW_MODEL_FAST, true),
      modelEffort: parseModelEffort(
        process.env.REVIEW_MODEL_EFFORT,
        "REVIEW_MODEL_EFFORT",
      ),
      dataDir,
      agentCwd: cwd,
      operatorId: "smoke-user",
      userText,
      assistantText: text,
    });
    console.log("review (detached):", review);
    if (agent.agentId !== conversationId) {
      throw new Error("detached review must not replace the conversation agent");
    }

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
