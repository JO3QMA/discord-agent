import { Agent } from "@cursor/sdk";
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

export function truncateReviewText(
  text: string,
  cap = REVIEW_TEXT_CAP,
): string {
  if (text.length <= cap) return text;
  const room = Math.max(0, cap - TRUNCATION_MARK.length);
  return text.slice(0, room) + TRUNCATION_MARK;
}

export function buildDetachedReviewPrompt(
  userText: string,
  assistantText: string,
): string {
  return [
    REVIEW_PROMPT,
    "",
    "=== LAST USER MESSAGE ===",
    truncateReviewText(userText),
    "",
    "=== LAST ASSISTANT REPLY ===",
    truncateReviewText(assistantText),
  ].join("\n");
}

export async function runDetachedReview(
  opts: AgentHandles & {
    operatorId: string;
    userText: string;
    assistantText: string;
  },
): Promise<string> {
  const agent = await Agent.create({
    apiKey: opts.apiKey,
    model: toModelSelection(
      opts.modelId,
      opts.modelFast ?? true,
      opts.modelEffort,
    ),
    mcpServers: builtinMcpConfig(opts.dataDir, opts.operatorId),
    local: { cwd: opts.agentCwd },
  });
  try {
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
  } finally {
    await agent.close();
  }
}
