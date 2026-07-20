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
import { searchMessages, openSearchDb } from "../search/fts.js";
import {
  createCronJob,
  loadCronJobs,
  removeCronJob,
  updateCronJob,
} from "../cron/store.js";
import {
  memoryGateOn,
  skillsGateOn,
  stageWrite,
} from "../approval/pending.js";
import { addTrait, formatUserModel } from "../honcho/store.js";
import { loadSettings } from "../gateway/settings.js";

const dataDir = process.env.DATA_DIR?.trim() || "./data";

function json(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

async function main() {
  await ensureMemoryLayout(dataDir);
  await ensureSkillsLayout(dataDir);
  openSearchDb(dataDir);

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
      const gated = await memoryGateOn(dataDir);
      if (gated) {
        const pending = await stageWrite(
          dataDir,
          "memory",
          action,
          `${action} ${target}: ${(content ?? old_text ?? "").slice(0, 80)}`,
          { target, content, old_text },
          true,
        );
        return json({
          success: true,
          staged: true,
          id: pending.id,
          message: "staged for Discord /memory approve",
        });
      }
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
        if (await skillsGateOn(dataDir)) {
          const pending = await stageWrite(
            dataDir,
            "skill",
            "create",
            `create ${name}`,
            { name, description, body },
            true,
          );
          return json({ success: true, staged: true, id: pending.id });
        }
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
        if (await skillsGateOn(dataDir)) {
          const pending = await stageWrite(
            dataDir,
            "skill",
            "patch",
            `patch ${name}`,
            { name, old_text, new_text },
            true,
          );
          return json({ success: true, staged: true, id: pending.id });
        }
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
        if (await skillsGateOn(dataDir)) {
          const pending = await stageWrite(
            dataDir,
            "skill",
            "delete",
            `delete ${name}`,
            { name },
            true,
          );
          return json({ success: true, staged: true, id: pending.id });
        }
        return json(await deleteSkill(dataDir, name));
      } catch (err) {
        return json({ success: false, error: String(err) });
      }
    },
  );

  server.tool(
    "session_search",
    "FTS5 search across past Discord session messages.",
    {
      query: z.string(),
      session_key: z.string().optional(),
      limit: z.number().optional(),
      since: z.string().optional(),
      before: z.string().optional(),
    },
    async ({ query, session_key, limit, since, before }) =>
      json(
        searchMessages(dataDir, query, {
          sessionKey: session_key,
          limit,
          since,
          before,
        }),
      ),
  );

  server.tool(
    "cronjob",
    "Manage scheduled jobs. Actions: list|create|pause|resume|run|remove|edit.",
    {
      action: z.enum([
        "list",
        "create",
        "pause",
        "resume",
        "run",
        "remove",
        "edit",
      ]),
      id: z.string().optional(),
      name: z.string().optional(),
      schedule: z.string().optional(),
      prompt: z.string().optional(),
      channel_id: z.string().optional(),
      no_agent: z.boolean().optional(),
    },
    async (args) => {
      try {
        if (args.action === "list") return json(await loadCronJobs(dataDir));
        if (args.action === "create") {
          const settings = await loadSettings(dataDir);
          const channelId =
            args.channel_id || settings.home?.channelId || "";
          if (!channelId) {
            return json({
              success: false,
              error: "channel_id or /sethome required",
            });
          }
          if (!args.schedule || !args.prompt) {
            return json({ success: false, error: "schedule and prompt required" });
          }
          return json(
            await createCronJob(dataDir, {
              name: args.name || "job",
              schedule: args.schedule,
              prompt: args.prompt,
              channelId,
              noAgent: args.no_agent,
            }),
          );
        }
        if (!args.id) return json({ success: false, error: "id required" });
        if (args.action === "remove") {
          return json({ success: await removeCronJob(dataDir, args.id) });
        }
        if (args.action === "pause") {
          return json(await updateCronJob(dataDir, args.id, { paused: true }));
        }
        if (args.action === "resume") {
          return json(await updateCronJob(dataDir, args.id, { paused: false }));
        }
        if (args.action === "run") {
          return json(
            await updateCronJob(dataDir, args.id, {
              nextRunAt: new Date(0).toISOString(),
            }),
          );
        }
        if (args.action === "edit") {
          return json(
            await updateCronJob(dataDir, args.id, {
              ...(args.name ? { name: args.name } : {}),
              ...(args.schedule ? { schedule: args.schedule } : {}),
              ...(args.prompt ? { prompt: args.prompt } : {}),
              ...(args.channel_id ? { channelId: args.channel_id } : {}),
            }),
          );
        }
        return json({ success: false, error: "unknown action" });
      } catch (err) {
        return json({ success: false, error: String(err) });
      }
    },
  );

  server.tool(
    "honcho_trait",
    "Add a durable user-model trait (local Honcho-style, no external service).",
    { trait: z.string() },
    async ({ trait }) => json(await addTrait(dataDir, trait)),
  );

  server.tool(
    "honcho_list",
    "List local user-model traits.",
    {},
    async () => json({ text: await formatUserModel(dataDir) }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
