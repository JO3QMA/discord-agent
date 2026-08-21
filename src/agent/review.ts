import { Agent, type SDKAgent } from "@cursor/sdk";
import {
  builtinMcpConfig,
  collectAssistantText,
  toModelSelection,
  type AgentHandles,
} from "./session.js";

const REVIEW_PROMPT = `Learning review (Hermes-style). This is a background pass after the user turn.

Rules:
1. Use ONLY the memory-skills MCP tools for persistence (memory, skills_*). Do not edit the workspace, run shell, or browse.
2. If there is a durable preference, environment fact, correction, or reusable procedure worth keeping, write it via MCP.
3. If nothing durable, do nothing with tools.
4. Reply with exactly one short line for Discord notification:
   - "Memory updated" / "Skill created: <name>" / "Skill patched: <name>" / "No memory changes"
   Keep it under 120 characters. No markdown fences.`;

const TRUNCATION_MARK = "…(truncated)";

// ponytail: 4000 chars each. Discord split posts can dwarf a turn; sending the
// whole assistant reply would re-inflate review tokens. Raise if Skill
// extraction from long coding turns starts missing the tail.
export const REVIEW_TEXT_CAP = 4000;

// ponytail: 5 min covers a slow model + a couple of MCP writes. A hung review
// would block commitSessionMeta and the conversation agent's close(). Env-ize
// if ops need to tune without a rebuild.
const REVIEW_TIMEOUT_MS = 5 * 60_000;

export function truncateReviewText(
  text: string,
  cap = REVIEW_TEXT_CAP,
): string {
  if (text.length <= cap) return text;
  let room = Math.max(0, cap - TRUNCATION_MARK.length);
  // Avoid a lone high surrogate when the cut lands inside a pair (emoji etc.).
  if (
    room > 0 &&
    text.charCodeAt(room - 1) >= 0xd800 &&
    text.charCodeAt(room - 1) <= 0xdbff
  ) {
    room -= 1;
  }
  return text.slice(0, room) + TRUNCATION_MARK;
}

/** Neutralize line-start `===` so embedded text cannot forge section markers. */
export function sanitizeReviewEmbed(text: string): string {
  return text.replace(/^(\s*)(===)/gm, "$1\u200B$2");
}

function prepareReviewEmbed(text: string): string {
  return sanitizeReviewEmbed(truncateReviewText(text));
}

export function buildDetachedReviewPrompt(
  userText: string,
  assistantText: string,
): string {
  return [
    REVIEW_PROMPT,
    "",
    "=== LAST USER MESSAGE ===",
    prepareReviewEmbed(userText),
    "",
    "=== LAST ASSISTANT REPLY ===",
    prepareReviewEmbed(assistantText),
  ].join("\n");
}

async function closeReviewAgent(agent: SDKAgent | undefined): Promise<void> {
  if (!agent) return;
  try {
    await agent.close();
  } catch (err) {
    console.error("detached review: agent close failed:", err);
  }
}

export async function runDetachedReview(
  opts: AgentHandles & {
    operatorId: string;
    userText: string;
    assistantText: string;
  },
): Promise<string> {
  let agent: SDKAgent | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("detached review timed out")),
      REVIEW_TIMEOUT_MS,
    );
  });
  const work = (async () => {
    agent = await Agent.create({
      apiKey: opts.apiKey,
      model: toModelSelection(
        opts.modelId,
        opts.modelFast ?? true,
        opts.modelEffort,
      ),
      mcpServers: builtinMcpConfig(opts.dataDir, opts.operatorId),
      local: { cwd: opts.agentCwd },
    });
    const run = await agent.send(
      buildDetachedReviewPrompt(opts.userText, opts.assistantText),
    );
    const { text } = await collectAssistantText(run);
    const line =
      text
        .split("\n")
        .map((l: string) => l.trim())
        .find(Boolean) ?? "No memory changes";
    return line.slice(0, 200);
  })();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (agent === undefined) {
      // Agent.create was still in flight when the race ended; close it once it lands.
      void work.finally(() => closeReviewAgent(agent)).catch(() => {});
    } else {
      await closeReviewAgent(agent);
      void work.catch(() => {});
    }
  }
}
