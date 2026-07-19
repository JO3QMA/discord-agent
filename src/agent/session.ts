import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, type SDKAgent } from "@cursor/sdk";
import { dataPaths } from "../config.js";
import { buildMemorySnapshot, ensureMemoryLayout } from "../memory/store.js";
import { ensureSkillsLayout, formatSkillsSummary } from "../skills/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SessionMeta = { agentId: string; turns: number };
export type SessionStore = Record<string, SessionMeta>;

function stdioEnv(dataDir: string): Record<string, string> {
  const env: Record<string, string> = { DATA_DIR: dataDir };
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  return env;
}

export function mcpServerConfig(dataDir: string) {
  const compiled = path.resolve(__dirname, "../mcp/server.js");
  const source = path.resolve(__dirname, "../mcp/server.ts");
  // When running via tsx from src/, spawn MCP the same way.
  const isTsRuntime = __dirname.includes(`${path.sep}src${path.sep}`);
  if (isTsRuntime) {
    return {
      memorySkills: {
        type: "stdio" as const,
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
      type: "stdio" as const,
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
        out[k] = { agentId: meta.agentId, turns: meta.turns ?? 1 };
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

export async function buildSystemPreamble(dataDir: string): Promise<string> {
  await ensureMemoryLayout(dataDir);
  await ensureSkillsLayout(dataDir);
  const snapshot = await buildMemorySnapshot(dataDir);
  const skills = await formatSkillsSummary(dataDir);
  return [
    "You are running via a Discord gateway on top of the Cursor agent runtime.",
    "Use the memory-skills MCP tools to persist durable facts and procedural skills.",
    "Memory targets: `memory` (environment/lessons) and `user` (profile/preferences).",
    "Respect character limits; consolidate when full.",
    "",
    "=== FROZEN MEMORY SNAPSHOT (session start; mid-session MCP writes apply next session) ===",
    snapshot,
    "",
    "=== AVAILABLE SKILLS ===",
    skills,
  ].join("\n");
}

export type AgentHandles = {
  apiKey: string;
  modelId: string;
  dataDir: string;
  agentCwd: string;
};

export async function openAgent(
  opts: AgentHandles,
  existingId?: string,
): Promise<SDKAgent> {
  const mcpServers = mcpServerConfig(opts.dataDir);
  const common = {
    apiKey: opts.apiKey,
    model: { id: opts.modelId },
    mcpServers,
    local: { cwd: opts.agentCwd },
  };
  if (existingId) {
    return Agent.resume(existingId, common);
  }
  return Agent.create(common);
}

export async function collectAssistantText(
  run: Awaited<ReturnType<SDKAgent["send"]>>,
): Promise<string> {
  const chunks: string[] = [];
  for await (const event of run.stream()) {
    if (event.type === "assistant") {
      for (const block of event.message.content) {
        if (block.type === "text") chunks.push(block.text);
      }
    }
  }
  const result = await run.wait();
  if (result.status === "error") {
    throw new Error(`agent run failed: ${result.id}`);
  }
  return chunks.join("") || "(no assistant text)";
}

export async function runUserTurn(
  agent: SDKAgent,
  dataDir: string,
  userText: string,
  isFirstTurn: boolean,
): Promise<string> {
  const preamble = isFirstTurn ? await buildSystemPreamble(dataDir) : null;
  const prompt = preamble
    ? `${preamble}\n\n=== USER MESSAGE ===\n${userText}`
    : userText;
  const run = await agent.send(prompt);
  return collectAssistantText(run);
}
