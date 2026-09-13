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
  assertSkillRelPath,
  createSkill,
  deleteSkill,
  ensureSkillsLayout,
  listSkills,
  patchSkill,
  viewSkill,
  writeSkillFile,
} from "../skills/store.js";
import { searchMessages, openSearchDb } from "../search/fts.js";
import {
  createCronJob,
  loadCronJobs,
  removeCronJob,
  updateCronJob,
} from "../cron/store.js";
import { stageWrite } from "../approval/pending.js";
import { loadSettings } from "../gateway/settings.js";
import { getActiveOperator } from "../operator/active.js";
import {
  MEMORY_TOOL_DESCRIPTION,
  SKILL_CREATE_DESCRIPTION,
  SKILL_PATCH_DESCRIPTION,
  SKILL_VIEW_DESCRIPTION,
  SKILL_WRITE_FILE_DESCRIPTION,
} from "../agent/learning-rules.js";

const dataDir = process.env.DATA_DIR?.trim() || "./data";

async function requireOperator(): Promise<string | { error: string }> {
  const fromEnv = process.env.MCP_ACTIVE_OPERATOR?.trim();
  if (fromEnv) return fromEnv;
  const id = await getActiveOperator(dataDir);
  if (!id) {
    return {
      error:
        "no active Operator — gateway must setActiveOperator before USER tools",
    };
  }
  return id;
}

function json(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

async function withSkillApproval(
  action: string,
  summary: string,
  payload: Record<string, unknown>,
  run: () => Promise<unknown>,
) {
  try {
    if ((await loadSettings(dataDir)).skillsWriteApproval) {
      const pending = await stageWrite(
        dataDir,
        "skill",
        action,
        summary,
        payload,
        true,
      );
      return json({ success: true, staged: true, id: pending.id });
    }
    return json(await run());
  } catch (err) {
    return json({ success: false, error: String(err) });
  }
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
    MEMORY_TOOL_DESCRIPTION,
    {
      action: z.enum(["add", "replace", "remove", "list"]),
      target: z.enum(["memory", "user"]),
      content: z.string().optional(),
      old_text: z.string().optional(),
    },
    async ({ action, target, content, old_text }) => {
      let operatorId: string | undefined;
      if (target === "user") {
        const op = await requireOperator();
        if (typeof op === "object") return json({ success: false, ...op });
        operatorId = op;
      }
      if (action === "list") return json(await memoryList(dataDir, target, operatorId));
      if ((await loadSettings(dataDir)).memoryWriteApproval) {
        const pending = await stageWrite(
          dataDir,
          "memory",
          action,
          `${action} ${target}: ${(content ?? old_text ?? "").slice(0, 80)}`,
          { target, content, old_text, operatorId },
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
        return json(await memoryAdd(dataDir, target, content, operatorId));
      }
      if (action === "replace") {
        if (!content || !old_text) {
          return json({ success: false, error: "content and old_text required" });
        }
        return json(
          await memoryReplace(dataDir, target, old_text, content, operatorId),
        );
      }
      if (!old_text) return json({ success: false, error: "old_text required" });
      return json(await memoryRemove(dataDir, target, old_text, operatorId));
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
    SKILL_VIEW_DESCRIPTION,
    { name: z.string(), path: z.string().optional() },
    async ({ name, path: filePath }) => {
      try {
        return json(await viewSkill(dataDir, name, filePath));
      } catch (err) {
        return json({ success: false, error: String(err) });
      }
    },
  );

  server.tool(
    "skill_create",
    SKILL_CREATE_DESCRIPTION,
    {
      name: z.string(),
      description: z.string(),
      body: z.string(),
    },
    async ({ name, description, body }) =>
      withSkillApproval("create", `create ${name}`, { name, description, body }, () =>
        createSkill(dataDir, name, description, body),
      ),
  );

  server.tool(
    "skill_patch",
    SKILL_PATCH_DESCRIPTION,
    {
      name: z.string(),
      old_text: z.string(),
      new_text: z.string(),
      path: z.string().optional(),
    },
    async ({ name, old_text, new_text, path: filePath }) => {
      try {
        const rel = filePath?.trim() ? assertSkillRelPath(filePath) : undefined;
        return await withSkillApproval(
          "patch",
          `patch ${name}${rel ? ` ${rel}` : ""}`,
          { name, old_text, new_text, path: rel },
          () => patchSkill(dataDir, name, old_text, new_text, rel),
        );
      } catch (err) {
        return json({ success: false, error: String(err) });
      }
    },
  );

  server.tool(
    "skill_write_file",
    SKILL_WRITE_FILE_DESCRIPTION,
    {
      name: z.string(),
      path: z.string(),
      content: z.string(),
    },
    async ({ name, path: filePath, content }) => {
      try {
        const rel = assertSkillRelPath(filePath);
        if (rel === "SKILL.md") {
          return json({
            success: false,
            error: "use skill_create or skill_patch for SKILL.md",
          });
        }
        return await withSkillApproval(
          "write_file",
          `write ${name} ${rel}`,
          { name, path: rel, content },
          () => writeSkillFile(dataDir, name, rel, content),
        );
      } catch (err) {
        return json({ success: false, error: String(err) });
      }
    },
  );

  server.tool(
    "skill_delete",
    "Delete a skill directory.",
    { name: z.string() },
    async ({ name }) =>
      withSkillApproval("delete", `delete ${name}`, { name }, () =>
        deleteSkill(dataDir, name),
      ),
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
      continuity: z.boolean().optional(),
      mode: z.enum(["agent", "monitor"]).optional(),
      notepad: z.boolean().optional(),
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
              continuity: args.continuity,
              mode: args.mode,
              notepad: args.notepad,
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
              ...(args.continuity !== undefined
                ? { continuity: args.continuity }
                : {}),
              ...(args.mode ? { mode: args.mode } : {}),
              ...(args.notepad !== undefined ? { notepad: args.notepad } : {}),
            }),
          );
        }
        return json({ success: false, error: "unknown action" });
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
