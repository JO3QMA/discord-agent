import type { SDKAgent } from "@cursor/sdk";
import { collectAssistantText } from "./session.js";

const REVIEW_PROMPT = `Learning review (Hermes-style). This is a background pass after the user turn.

Rules:
1. Use ONLY the memory-skills MCP tools for persistence (memory, skills_*). Do not edit the workspace, run shell, or browse.
2. If there is a durable preference, environment fact, correction, or reusable procedure worth keeping, write it via MCP.
3. If nothing durable, do nothing with tools.
4. Reply with exactly one short line for Discord notification:
   - "Memory updated" / "Skill created: <name>" / "Skill patched: <name>" / "No memory changes"
   Keep it under 120 characters. No markdown fences.`;

export async function runPostTurnReview(agent: SDKAgent): Promise<string> {
  const run = await agent.send(REVIEW_PROMPT);
  const { text } = await collectAssistantText(run);
  const line =
    text
      .split("\n")
      .map((l: string) => l.trim())
      .find(Boolean) ?? "No memory changes";
  return line.slice(0, 200);
}
