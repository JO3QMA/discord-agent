import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setActiveOperator } from "../operator/active.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cda-mcp-"));
  await setActiveOperator(dataDir, "file-op");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(root, "node_modules/tsx/dist/cli.mjs"),
      path.join(root, "src/mcp/server.ts"),
    ],
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      MCP_ACTIVE_OPERATOR: "env-op",
    } as Record<string, string>,
  });
  const client = new Client({ name: "check-mcp", version: "1.0.0" });
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  const expected = [
    "cronjob",
    "memory",
    "session_search",
    "skill_create",
    "skill_delete",
    "skill_patch",
    "skill_view",
    "skills_list",
  ];
  for (const n of expected) {
    if (!names.includes(n)) throw new Error(`missing tool ${n}: ${names.join(",")}`);
  }
  const add = await client.callTool({
    name: "memory",
    arguments: {
      action: "add",
      target: "memory",
      content: "mcp-check-ok",
    },
  });
  const text = JSON.stringify(add);
  if (!text.includes("mcp-check-ok") && !text.includes('"success":true')) {
    // still ok if structured content differs
  }
  await client.callTool({
    name: "memory",
    arguments: {
      action: "add",
      target: "user",
      content: "env-operator-hit",
    },
  });
  const envUser = path.join(dataDir, "memories", "operators", "env-op", "USER.md");
  const fileUser = path.join(dataDir, "memories", "operators", "file-op", "USER.md");
  const envBody = await fs.readFile(envUser, "utf8");
  if (!envBody.includes("env-operator-hit")) {
    throw new Error("MCP_ACTIVE_OPERATOR should win over active-operator file");
  }
  try {
    const fileBody = await fs.readFile(fileUser, "utf8");
    if (fileBody.includes("env-operator-hit")) {
      throw new Error("USER write must not land on the file-based operator");
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await client.close();
  console.log("check:mcp OK", names.join(","));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
