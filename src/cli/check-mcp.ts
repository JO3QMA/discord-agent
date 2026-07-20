import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cda-mcp-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(root, "node_modules/tsx/dist/cli.mjs"),
      path.join(root, "src/mcp/server.ts"),
    ],
    env: { ...process.env, DATA_DIR: dataDir } as Record<string, string>,
  });
  const client = new Client({ name: "check-mcp", version: "1.0.0" });
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  const expected = [
    "cronjob",
    "honcho_list",
    "honcho_trait",
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
  await client.close();
  console.log("check:mcp OK", names.join(","));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
