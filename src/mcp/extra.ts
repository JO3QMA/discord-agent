import fs from "node:fs/promises";
import path from "node:path";
import type { McpServerConfig } from "@cursor/sdk";

export type ExtraMcpFile = {
  servers: Record<string, McpServerConfig>;
};

export async function loadExtraMcp(
  dataDir: string,
): Promise<Record<string, McpServerConfig>> {
  const file = path.join(dataDir, "mcp.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as ExtraMcpFile;
    return parsed.servers ?? {};
  } catch {
    return {};
  }
}

/** Merge memory-skills + optional data/mcp.json (+ MCP_SERVERS_JSON env). */
export async function mergeMcpServers(
  dataDir: string,
  builtin: Record<string, McpServerConfig>,
): Promise<Record<string, McpServerConfig>> {
  const extra = await loadExtraMcp(dataDir);
  let fromEnv: Record<string, McpServerConfig> = {};
  const envJson = process.env.MCP_SERVERS_JSON?.trim();
  if (envJson) {
    try {
      fromEnv = (JSON.parse(envJson) as ExtraMcpFile).servers ?? {};
    } catch (err) {
      console.error("MCP_SERVERS_JSON parse error:", err);
    }
  }
  return { ...builtin, ...extra, ...fromEnv };
}
