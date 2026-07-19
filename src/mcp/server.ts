#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ensureMemoryLayout,
  memoryAdd,
  memoryRemove,
  memoryReplace,
  memoryList,
} from "../memory/store.js";
import {
  createSkill,
  deleteSkill,
  ensureSkillsLayout,
  listSkills,
  patchSkill,
  viewSkill,
} from "../skills/store.js";

const dataDir = process.env.DATA_DIR?.trim() || "./data";

function json(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

async function main() {
  await ensureMemoryLayout(dataDir);
  await ensureSkillsLayout(dataDir);

  const server = new McpServer({
    name: "memory-skills",
    version: "1.0.0",
  });

  server.tool(
    "memory",
    "Curated persistent memory (Hermes-style). Targets: memory (notes) or user (profile). Actions: add|replace|remove|list.",
    {
      action: z.enum(["add", "replace", "remove", "list"]),
      target: z.enum(["memory", "user"]),
      content: z.string().optional(),
      old_text: z.string().optional(),
    },
    async ({ action, target, content, old_text }) => {
      if (action === "list") return json(await memoryList(dataDir, target));
      if (action === "add") {
        if (!content) return json({ success: false, error: "content required" });
        return json(await memoryAdd(dataDir, target, content));
      }
      if (action === "replace") {
        if (!content || !old_text) {
          return json({ success: false, error: "content and old_text required" });
        }
        return json(await memoryReplace(dataDir, target, old_text, content));
      }
      if (!old_text) return json({ success: false, error: "old_text required" });
      return json(await memoryRemove(dataDir, target, old_text));
    },
  );

  server.tool(
    "skills_list",
    "List installed procedural skills under DATA_DIR/skills.",
    {},
    async () => json(await listSkills(dataDir)),
  );

  server.tool(
    "skill_view",
    "Read a skill's SKILL.md by name.",
    { name: z.string() },
    async ({ name }) => {
      try {
        return json(await viewSkill(dataDir, name));
      } catch (err) {
        return json({ success: false, error: String(err) });
      }
    },
  );

  server.tool(
    "skill_create",
    "Create a new skill (agentskills.io minimal: frontmatter name+description ≤60 chars + body).",
    {
      name: z.string(),
      description: z.string(),
      body: z.string(),
    },
    async ({ name, description, body }) => {
      try {
        return json(await createSkill(dataDir, name, description, body));
      } catch (err) {
        return json({ success: false, error: String(err) });
      }
    },
  );

  server.tool(
    "skill_patch",
    "Surgical replace inside an existing SKILL.md (old_text must match once).",
    {
      name: z.string(),
      old_text: z.string(),
      new_text: z.string(),
    },
    async ({ name, old_text, new_text }) => {
      try {
        return json(await patchSkill(dataDir, name, old_text, new_text));
      } catch (err) {
        return json({ success: false, error: String(err) });
      }
    },
  );

  server.tool(
    "skill_delete",
    "Delete a skill directory.",
    { name: z.string() },
    async ({ name }) => {
      try {
        return json(await deleteSkill(dataDir, name));
      } catch (err) {
        return json({ success: false, error: String(err) });
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
