import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Agent,
  AgentNotFoundError,
  type McpServerConfig,
  type Run,
  type SDKAgent,
  type SDKMessage,
  type SDKUserMessage,
} from "@cursor/sdk";
import { dataPaths } from "../config.js";
import { buildMemorySnapshot, ensureMemoryLayout, memoryList, ENTRY_SEP } from "../memory/store.js";
import { ensureSkillsLayout, formatSkillsSummary } from "../skills/store.js";
import { mergeMcpServers } from "../mcp/extra.js";
import { buildSoulBlock } from "../soul/store.js";
import { loadSettings } from "../gateway/settings.js";
import { setActiveOperator } from "../operator/active.js";
import { operatorKey } from "../discord/conversation-key.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SessionMeta = {
  agentId: string;
  turns: number;
  title?: string;
  lastUserText?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Last operator whose block was actually sent this conversation. */
  lastOperatorId?: string;
  /** sha256 of the last Operator block that was actually sent. */
  lastOperatorBlockHash?: string;
};

export type SessionStore = Record<string, SessionMeta>;

function stdioEnv(dataDir: string): Record<string, string> {
  const env: Record<string, string> = { DATA_DIR: dataDir };
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  return env;
}

export function builtinMcpConfig(dataDir: string): Record<string, McpServerConfig> {
  const compiled = path.resolve(__dirname, "../mcp/server.js");
  const source = path.resolve(__dirname, "../mcp/server.ts");
  const isTsRuntime = __dirname.includes(`${path.sep}src${path.sep}`);
  if (isTsRuntime) {
    return {
      memorySkills: {
        type: "stdio",
        command: process.execPath,
        args: [
          path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs"),
          source,
        ],
        env: stdioEnv(dataDir),
      },
    };
  }
  return {
    memorySkills: {
      type: "stdio",
      command: process.execPath,
      args: [compiled],
      env: stdioEnv(dataDir),
    },
  };
}

export async function loadSessionStore(dataDir: string): Promise<SessionStore> {
  const file = dataPaths(dataDir).sessionsFile;
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: SessionStore = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") {
        out[k] = { agentId: v, turns: 1 };
      } else if (v && typeof v === "object" && "agentId" in v) {
        const meta = v as SessionMeta;
        out[k] = { ...meta, turns: meta.turns ?? 1 };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveSessionStore(
  dataDir: string,
  store: SessionStore,
): Promise<void> {
  const file = dataPaths(dataDir).sessionsFile;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(store, null, 2), "utf8");
}

/**
 * Persist turn meta without resurrecting a session that was cleared (/new etc.)
 * while this turn held a stale in-memory store.
 * Returns false if the write was skipped because the mapping was cleared/replaced.
 */
export async function commitSessionMeta(
  dataDir: string,
  key: string,
  openedAgentId: string | undefined,
  next: SessionMeta,
): Promise<boolean> {
  const latest = await loadSessionStore(dataDir);
  const cur = latest[key];
  // Cleared while we ran (/new, /undo, …) — do not bring the old agent back.
  if (openedAgentId && !cur) return false;
  // Another create/resume replaced the mapping under us.
  if (cur && openedAgentId && cur.agentId !== openedAgentId && cur.agentId !== next.agentId) {
    return false;
  }
  latest[key] = next;
  await saveSessionStore(dataDir, latest);
  return true;
}

export async function clearSessionKey(
  dataDir: string,
  key: string,
): Promise<SessionMeta | undefined> {
  const store = await loadSessionStore(dataDir);
  const prev = store[key];
  if (!prev) return undefined;
  delete store[key];
  await saveSessionStore(dataDir, store);
  return prev;
}

export async function buildOperatorBlock(
  dataDir: string,
  operatorId: string,
): Promise<string> {
  await ensureMemoryLayout(dataDir);
  const settings = await loadSettings(dataDir);
  const personality = settings.personalityByOperator[operatorKey(operatorId)];
  const soul = await buildSoulBlock(dataDir, personality);
  const user = await memoryList(dataDir, "user", operatorId);
  const userBody = user.entries.length
    ? user.entries.join(ENTRY_SEP)
    : "(empty USER profile)";
  return [
    `=== CURRENT OPERATOR (\`${operatorId}\`) ===`,
    soul,
    "",
    "=== USER PROFILE (Operator-scoped) ===",
    user.header,
    userBody,
  ].join("\n");
}

export function hashOperatorBlock(block: string): string {
  return createHash("sha256").update(block, "utf8").digest("hex");
}

export function shouldSendOperatorBlock(
  isFirst: boolean,
  operatorId: string,
  blockHash: string,
  meta?: Pick<SessionMeta, "lastOperatorId" | "lastOperatorBlockHash"> | null,
): boolean {
  return (
    isFirst ||
    operatorId !== meta?.lastOperatorId ||
    blockHash !== meta?.lastOperatorBlockHash
  );
}

export async function buildSystemPreamble(
  dataDir: string,
  operatorId: string,
  operatorBlock?: string,
): Promise<string> {
  await ensureMemoryLayout(dataDir);
  await ensureSkillsLayout(dataDir);
  const block = operatorBlock ?? (await buildOperatorBlock(dataDir, operatorId));
  const snapshot = await buildMemorySnapshot(dataDir);
  const skills = await formatSkillsSummary(dataDir);
  return [
    "You are running via a Discord gateway on top of the Cursor agent runtime.",
    "Use the memory-skills MCP tools to persist durable facts and procedural skills.",
    "Also available: session_search, cronjob tools when exposed.",
    "Memory targets: `memory` (shared environment/lessons) and `user` (this Operator's profile).",
    "Respect character limits; consolidate when full.",
    "This Discord channel/thread shares one Cursor session among allowed Operators; personal profile is Operator-scoped.",
    "",
    block,
    "",
    "=== FROZEN MEMORY SNAPSHOT (session start; mid-session MCP writes apply next session) ===",
    snapshot,
    "",
    "=== AVAILABLE SKILLS ===",
    skills,
  ]
    .filter(Boolean)
    .join("\n");
}

export type AgentHandles = {
  apiKey: string;
  modelId: string;
  /** 省略時は false（非 fast）。全モデルに fast param を明示する。 */
  modelFast?: boolean;
  /** 省略時は effort param を送らない。 */
  modelEffort?: string | null;
  dataDir: string;
  agentCwd: string;
};

export type ModelSelectionParams = Array<{ id: string; value: string }>;

/** Build SDK ModelSelection. Omitting params lets SDK pick first allowed (often fast=true). */
export function toModelSelection(
  modelId: string,
  modelFast = false,
  modelEffort?: string | null,
): { id: string; params: ModelSelectionParams } {
  // ponytail: always send fast; extra params are ignored if the model lacks them.
  // Catalog-driven params would need Cursor.models.list() per API key.
  const params: ModelSelectionParams = [
    { id: "fast", value: modelFast ? "true" : "false" },
  ];
  if (modelEffort) params.unshift({ id: "effort", value: modelEffort });
  return { id: modelId, params };
}

export function formatModelLabel(
  modelId: string,
  modelFast = false,
  modelEffort?: string | null,
): string {
  const bits = [`fast=${modelFast}`];
  if (modelEffort) bits.unshift(`effort=${modelEffort}`);
  return `${modelId} (${bits.join(", ")})`;
}

export type OpenedAgent = {
  agent: SDKAgent;
  /** false when we had to create because resume target was gone (rebuild, wiped SDK state, etc.) */
  resumed: boolean;
};

export async function openAgent(
  opts: AgentHandles,
  existingId?: string,
): Promise<OpenedAgent> {
  const mcpServers = await mergeMcpServers(
    opts.dataDir,
    builtinMcpConfig(opts.dataDir),
  );
  const common = {
    apiKey: opts.apiKey,
    model: toModelSelection(
      opts.modelId,
      opts.modelFast ?? false,
      opts.modelEffort,
    ),
    mcpServers,
    local: { cwd: opts.agentCwd },
  };
  if (existingId) {
    try {
      return { agent: await Agent.resume(existingId, common), resumed: true };
    } catch (err) {
      // sessions.json lives on /data, but local SDK agent blobs live in the
      // container filesystem and vanish on image recreate — not an env misconfig.
      if (err instanceof AgentNotFoundError || (err as { code?: string }).code === "agent_not_found") {
        console.warn(
          `agent ${existingId} not found; creating a new session (stale sessions.json after rebuild is common)`,
        );
      } else {
        throw err;
      }
    }
  }
  return { agent: await Agent.create(common), resumed: false };
}

export type TurnProgress = (line: string) => void | Promise<void>;

export async function collectAssistantText(
  run: Run,
  onProgress?: TurnProgress,
): Promise<{
  text: string;
  usage?: { input?: number; output?: number };
  cancelled: boolean;
}> {
  const chunks: string[] = [];
  let usage: { input?: number; output?: number } | undefined;
  for await (const event of run.stream()) {
    await handleProgress(event, onProgress);
    if (event.type === "assistant") {
      for (const block of event.message.content) {
        if (block.type === "text") chunks.push(block.text);
      }
    }
    if (event.type === "usage") {
      usage = {
        input: event.usage?.inputTokens,
        output: event.usage?.outputTokens,
      };
    }
  }
  const result = await run.wait();
  if (result.status === "cancelled") {
    return { text: chunks.join("") || "(cancelled)", usage, cancelled: true };
  }
  if (result.status === "error") {
    throw new Error(`agent run failed: ${result.error?.message ?? result.id}`);
  }
  if (result.usage) {
    usage = {
      input: result.usage.inputTokens,
      output: result.usage.outputTokens,
    };
  }
  return {
    text: chunks.join("") || result.result || "(no assistant text)",
    usage,
    cancelled: false,
  };
}

async function handleProgress(
  event: SDKMessage,
  onProgress: TurnProgress | undefined,
): Promise<void> {
  if (!onProgress) return;
  if (event.type === "tool_call" && event.status === "running") {
    await onProgress(`🔧 ${event.name}`);
  } else if (event.type === "status" && event.message) {
    await onProgress(event.message);
  } else if (event.type === "thinking") {
    await onProgress("💭 thinking…");
  }
}

export async function runUserTurn(
  agent: SDKAgent,
  dataDir: string,
  userText: string,
  isFirstTurn: boolean,
  opts?: {
    operatorId: string;
    conversationKey?: string;
    lastOperatorId?: string;
    lastOperatorBlockHash?: string;
    images?: Array<{ data: string; mimeType: string }>;
    onProgress?: TurnProgress;
    registerRun?: (run: Run) => void;
  },
): Promise<{
  text: string;
  usage?: { input?: number; output?: number };
  cancelled: boolean;
  run: Run;
  operatorId: string;
  operatorBlockHash: string;
}> {
  if (!opts?.operatorId) {
    throw new Error("operatorId is required for runUserTurn");
  }
  await setActiveOperator(dataDir, opts.operatorId);
  const operatorBlock = await buildOperatorBlock(dataDir, opts.operatorId);
  const currentHash = hashOperatorBlock(operatorBlock);
  const sendBlock = shouldSendOperatorBlock(
    isFirstTurn,
    opts.operatorId,
    currentHash,
    opts,
  );
  // Omit === USER MESSAGE === too: the marker is only a fence for the block.
  const prompt = sendBlock
    ? `${isFirstTurn ? await buildSystemPreamble(dataDir, opts.operatorId, operatorBlock) : operatorBlock}\n\n=== USER MESSAGE ===\n${userText}`
    : userText;
  const message: string | SDKUserMessage =
    opts?.images?.length
      ? { text: prompt, images: opts.images }
      : prompt;
  const run = await agent.send(message);
  opts?.registerRun?.(run);
  const collected = await collectAssistantText(run, opts?.onProgress);
  return {
    ...collected,
    run,
    operatorId: opts.operatorId,
    // Omitted turn: keep the last *sent* hash, not a newly computed one.
    operatorBlockHash: sendBlock
      ? currentHash
      : (opts.lastOperatorBlockHash ?? currentHash),
  };
}

/** One-shot agent for cron / background (always create, then close). */
export async function runEphemeralPrompt(
  opts: AgentHandles,
  prompt: string,
  operatorId = "system",
): Promise<string> {
  const { agent } = await openAgent(opts);
  try {
    const { text } = await runUserTurn(agent, opts.dataDir, prompt, true, {
      operatorId,
    });
    return text;
  } finally {
    await agent.close();
  }
}
