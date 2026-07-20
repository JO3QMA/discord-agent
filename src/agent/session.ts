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
import { buildMemorySnapshot, ensureMemoryLayout } from "../memory/store.js";
import { ensureSkillsLayout, formatSkillsSummary } from "../skills/store.js";
import { mergeMcpServers } from "../mcp/extra.js";
import { buildSoulBlock } from "../soul/store.js";
import { formatUserModel } from "../honcho/store.js";
import { loadSettings } from "../gateway/settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SessionMeta = {
  agentId: string;
  turns: number;
  title?: string;
  lastUserText?: string;
  inputTokens?: number;
  outputTokens?: number;
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

/** @deprecated use builtinMcpConfig + merge */
export function mcpServerConfig(dataDir: string) {
  return builtinMcpConfig(dataDir);
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

export async function buildSystemPreamble(
  dataDir: string,
  sessionKey?: string,
): Promise<string> {
  await ensureMemoryLayout(dataDir);
  await ensureSkillsLayout(dataDir);
  const settings = await loadSettings(dataDir);
  const personality = sessionKey
    ? settings.personalityBySession[sessionKey]
    : undefined;
  const soul = await buildSoulBlock(dataDir, personality);
  const snapshot = await buildMemorySnapshot(dataDir);
  const skills = await formatSkillsSummary(dataDir);
  const honcho = await formatUserModel(dataDir);
  return [
    "You are running via a Discord gateway on top of the Cursor agent runtime.",
    "Use the memory-skills MCP tools to persist durable facts and procedural skills.",
    "Also available: session_search, cronjob, honcho_trait tools when exposed.",
    "Memory targets: `memory` (environment/lessons) and `user` (profile/preferences).",
    "Respect character limits; consolidate when full.",
    "",
    soul,
    "",
    "=== USER MODEL (local Honcho-style) ===",
    honcho,
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
  /** Composer 系のみ適用。省略時は false（非 fast）。 */
  modelFast?: boolean;
  dataDir: string;
  agentCwd: string;
};

/** Build SDK ModelSelection. Composer omits params → default variant is fast=true. */
export function toModelSelection(
  modelId: string,
  modelFast = false,
): { id: string; params?: Array<{ id: string; value: string }> } {
  if (modelId.startsWith("composer")) {
    return {
      id: modelId,
      params: [{ id: "fast", value: modelFast ? "true" : "false" }],
    };
  }
  return { id: modelId };
}

export function formatModelLabel(modelId: string, modelFast = false): string {
  if (modelId.startsWith("composer")) {
    return `${modelId} (fast=${modelFast})`;
  }
  return modelId;
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
    model: toModelSelection(opts.modelId, opts.modelFast ?? false),
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
): Promise<{ text: string; usage?: { input?: number; output?: number } }> {
  const chunks: string[] = [];
  let usage: { input?: number; output?: number } | undefined;
  let lastTool = "";
  for await (const event of run.stream()) {
    await handleProgress(event, onProgress, (t) => {
      lastTool = t;
    });
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
    return { text: chunks.join("") || "(cancelled)", usage };
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
  void lastTool;
  return { text: chunks.join("") || result.result || "(no assistant text)", usage };
}

async function handleProgress(
  event: SDKMessage,
  onProgress: TurnProgress | undefined,
  setTool: (name: string) => void,
): Promise<void> {
  if (!onProgress) return;
  if (event.type === "tool_call" && event.status === "running") {
    setTool(event.name);
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
    sessionKey?: string;
    images?: Array<{ data: string; mimeType: string }>;
    onProgress?: TurnProgress;
    registerRun?: (run: Run) => void;
  },
): Promise<{ text: string; usage?: { input?: number; output?: number }; run: Run }> {
  const preamble = isFirstTurn
    ? await buildSystemPreamble(dataDir, opts?.sessionKey)
    : null;
  const prompt = preamble
    ? `${preamble}\n\n=== USER MESSAGE ===\n${userText}`
    : userText;
  const message: string | SDKUserMessage =
    opts?.images?.length
      ? { text: prompt, images: opts.images }
      : prompt;
  const run = await agent.send(message);
  opts?.registerRun?.(run);
  const collected = await collectAssistantText(run, opts?.onProgress);
  return { ...collected, run };
}

/** One-shot agent for cron / background (always create, then close). */
export async function runEphemeralPrompt(
  opts: AgentHandles,
  prompt: string,
): Promise<string> {
  const { agent } = await openAgent(opts);
  try {
    const { text } = await runUserTurn(agent, opts.dataDir, prompt, true);
    return text;
  } finally {
    await agent.close();
  }
}
