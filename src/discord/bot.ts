import {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import type { Run } from "@cursor/sdk";
import type { AppConfig } from "../config.js";
import { runPostTurnReview } from "../agent/review.js";
import {
  loadSessionStore,
  openAgent,
  runEphemeralPrompt,
  runUserTurn,
  saveSessionStore,
  clearSessionKey,
  commitSessionMeta,
  formatModelLabel,
  type SessionMeta,
} from "../agent/session.js";
import { ensureMemoryLayout, formatMemorySummary } from "../memory/store.js";
import { ensureSkillsLayout, formatSkillsSummary } from "../skills/store.js";
import {
  indexMessage,
  searchMessages,
  deleteLastExchange,
  openSearchDb,
} from "../search/fts.js";
import {
  loadSettings,
  updateSettings,
  type VoiceMode,
} from "../gateway/settings.js";
import { listPending } from "../approval/pending.js";
import { applyPending, approveAll, rejectPending } from "../approval/apply.js";
import {
  createCronJob,
  loadCronJobs,
  removeCronJob,
  startCronScheduler,
  updateCronJob,
} from "../cron/store.js";
import {
  ensureSoulLayout,
  listPersonalities,
} from "../soul/store.js";
import { formatUserModel, addTrait } from "../honcho/store.js";
import { installSkillFromSource } from "../skills/hub.js";
import {
  isVoiceAttachment,
  prepareMessageAttachments,
} from "./attachments.js";
import {
  synthesizeSpeech,
  toWavIfNeeded,
  transcribeFile,
  voiceConfigFromEnv,
} from "../voice/stt-tts.js";
import { vcJoin, vcLeave, vcStatus } from "../voice/vc.js";
import fs from "node:fs/promises";
import path from "node:path";

type Active = {
  run: Run;
  queue: string[];
};

const slashCommands = [
  new SlashCommandBuilder()
    .setName("new")
    .setDescription("エージェントセッションを破棄し、次のメッセージで新規作成する"),
  new SlashCommandBuilder()
    .setName("memory")
    .setDescription("MEMORY/USER 表示、または承認ゲート操作")
    .addStringOption((o) =>
      o
        .setName("action")
        .setDescription("pending|approve|reject|approval|show")
        .addChoices(
          { name: "show", value: "show" },
          { name: "pending", value: "pending" },
          { name: "approve", value: "approve" },
          { name: "reject", value: "reject" },
          { name: "approval", value: "approval" },
        ),
    )
    .addStringOption((o) =>
      o.setName("id").setDescription("pending id / all / on|off"),
    ),
  new SlashCommandBuilder()
    .setName("skills")
    .setDescription("skills 一覧・承認・install")
    .addStringOption((o) =>
      o
        .setName("action")
        .setDescription("list|pending|approve|reject|approval|install")
        .addChoices(
          { name: "list", value: "list" },
          { name: "pending", value: "pending" },
          { name: "approve", value: "approve" },
          { name: "reject", value: "reject" },
          { name: "approval", value: "approval" },
          { name: "install", value: "install" },
        ),
    )
    .addStringOption((o) =>
      o.setName("id").setDescription("pending id / all / on|off / URL"),
    )
    .addStringOption((o) =>
      o.setName("name").setDescription("install 時の skill 名ヒント"),
    ),
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("過去セッションを FTS5 検索")
    .addStringOption((o) =>
      o.setName("query").setDescription("検索語").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("実行中のエージェントを中断"),
  new SlashCommandBuilder()
    .setName("retry")
    .setDescription("直前のユーザー発話を再送"),
  new SlashCommandBuilder()
    .setName("undo")
    .setDescription("直前交換をローカル履歴から削除しセッションをリセット"),
  new SlashCommandBuilder()
    .setName("title")
    .setDescription("セッションにタイトルを付ける")
    .addStringOption((o) => o.setName("name").setDescription("タイトル")),
  new SlashCommandBuilder()
    .setName("sessions")
    .setDescription("名前付きセッション一覧"),
  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("名前付きセッションへ切替")
    .addStringOption((o) =>
      o.setName("name").setDescription("タイトル").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("personality")
    .setDescription("personality 切替")
    .addStringOption((o) => o.setName("name").setDescription("名前または list")),
  new SlashCommandBuilder()
    .setName("model")
    .setDescription("モデル表示・切替")
    .addStringOption((o) => o.setName("name").setDescription("モデル id")),
  new SlashCommandBuilder()
    .setName("usage")
    .setDescription("セッション使用量"),
  new SlashCommandBuilder()
    .setName("sethome")
    .setDescription("このチャンネルをホームに設定"),
  new SlashCommandBuilder()
    .setName("reload-mcp")
    .setDescription("MCP 設定を再読込（次回 create から反映）"),
  new SlashCommandBuilder()
    .setName("cron")
    .setDescription("cron ジョブ操作")
    .addStringOption((o) =>
      o
        .setName("action")
        .setDescription("list|create|pause|resume|run|remove")
        .setRequired(true)
        .addChoices(
          { name: "list", value: "list" },
          { name: "create", value: "create" },
          { name: "pause", value: "pause" },
          { name: "resume", value: "resume" },
          { name: "run", value: "run" },
          { name: "remove", value: "remove" },
        ),
    )
    .addStringOption((o) => o.setName("id").setDescription("job id"))
    .addStringOption((o) => o.setName("schedule").setDescription("cron 式"))
    .addStringOption((o) => o.setName("prompt").setDescription("プロンプト"))
    .addStringOption((o) => o.setName("name").setDescription("ジョブ名")),
  new SlashCommandBuilder()
    .setName("voice")
    .setDescription("音声モード / VC")
    .addStringOption((o) =>
      o
        .setName("action")
        .setDescription("on|off|tts|status|join|leave")
        .setRequired(true)
        .addChoices(
          { name: "on", value: "on" },
          { name: "off", value: "off" },
          { name: "tts", value: "tts" },
          { name: "status", value: "status" },
          { name: "join", value: "join" },
          { name: "leave", value: "leave" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("background")
    .setDescription("別セッションでプロンプト実行")
    .addStringOption((o) =>
      o.setName("prompt").setDescription("プロンプト").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("approve")
    .setDescription("pending 書き込みを承認（危険コマンドは Cursor SDK 非対応）")
    .addStringOption((o) =>
      o.setName("id").setDescription("pending id または all").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("deny")
    .setDescription("pending 書き込みを拒否")
    .addStringOption((o) =>
      o.setName("id").setDescription("pending id または all").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("honcho")
    .setDescription("ローカルユーザモデル")
    .addStringOption((o) =>
      o
        .setName("action")
        .setDescription("list|add")
        .addChoices(
          { name: "list", value: "list" },
          { name: "add", value: "add" },
        ),
    )
    .addStringOption((o) => o.setName("trait").setDescription("trait 文言")),
].map((c) => c.toJSON());

function sessionKeyForUser(userId: string, channel: TextBasedChannel | null): string {
  if (channel?.isThread()) return `thread:${channel.id}`;
  return `user:${userId}`;
}

function isAllowedUser(cfg: AppConfig, userId: string): boolean {
  return cfg.allowedUserIds.has(userId);
}

function isAllowedChannel(
  cfg: AppConfig,
  channel: TextBasedChannel | null,
): boolean {
  if (cfg.allowedChannelIds.size === 0) return true;
  if (!channel) return false;
  if (cfg.allowedChannelIds.has(channel.id)) return true;
  if (channel.isThread() && channel.parentId && cfg.allowedChannelIds.has(channel.parentId)) {
    return true;
  }
  return false;
}

function stripBotMentions(content: string, botId: string): string {
  return content.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
}

async function sendChunked(
  send: (content: string) => Promise<unknown>,
  content: string,
): Promise<void> {
  const max = 1900;
  let rest = content;
  while (rest.length > 0) {
    const chunk = rest.slice(0, max);
    rest = rest.slice(max);
    await send(chunk);
  }
}

async function replyMessage(message: Message, content: string): Promise<void> {
  await sendChunked((c) => message.reply({ content: c }), content);
}

async function replyInteraction(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  const max = 1900;
  if (!interaction.deferred && !interaction.replied) {
    if (content.length <= max) {
      await interaction.reply({ content });
      return;
    }
    await interaction.reply({ content: content.slice(0, max) });
    await sendChunked(
      (c) => interaction.followUp({ content: c }),
      content.slice(max),
    );
    return;
  }
  if (content.length <= max) {
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.followUp({ content });
    }
    return;
  }
  const first = content.slice(0, max);
  const rest = content.slice(max);
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ content: first });
  } else {
    await interaction.followUp({ content: first });
  }
  await sendChunked((c) => interaction.followUp({ content: c }), rest);
}

async function ensureWorkspace(agentCwd: string): Promise<void> {
  await fs.mkdir(agentCwd, { recursive: true });
  const readme = `${agentCwd}/README.md`;
  try {
    await fs.access(readme);
  } catch {
    await fs.writeFile(
      readme,
      "# Agent workspace\n\nCursor agent local cwd for this gateway.\n",
      "utf8",
    );
  }
}

async function registerSlashCommands(
  cfg: AppConfig,
  applicationId: string,
): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(cfg.discordBotToken);
  if (cfg.discordGuildId) {
    // Guild commands appear instantly. Clear global commands so Discord does not
    // show the same names twice (global + guild overlap after switching modes).
    await rest.put(
      Routes.applicationGuildCommands(applicationId, cfg.discordGuildId),
      { body: slashCommands },
    );
    await rest.put(Routes.applicationCommands(applicationId), { body: [] });
    console.log(
      `slash commands registered for guild ${cfg.discordGuildId} (global cleared)`,
    );
    return;
  }
  await rest.put(Routes.applicationCommands(applicationId), {
    body: slashCommands,
  });
  console.log("slash commands registered globally (may take up to ~1h to appear)");
}

function agentOpts(cfg: AppConfig, modelId: string) {
  return {
    apiKey: cfg.cursorApiKey,
    modelId,
    modelFast: cfg.modelFast,
    dataDir: cfg.dataDir,
    agentCwd: cfg.agentCwd,
  };
}

async function resolveModel(
  cfg: AppConfig,
  dataDir: string,
  sessionKey: string,
): Promise<string> {
  const s = await loadSettings(dataDir);
  return s.modelBySession[sessionKey] || cfg.modelId;
}

async function handleSlash(
  cfg: AppConfig,
  client: Client,
  interaction: ChatInputCommandInteraction,
  busy: Set<string>,
  active: Map<string, Active>,
  namedIndex: Map<string, { key: string; agentId: string }>,
  runTurn: (args: {
    key: string;
    userId: string;
    channel: TextBasedChannel;
    text: string;
    reply: (content: string) => Promise<void>;
    statusTarget?: Message | ChatInputCommandInteraction;
    attachmentsMessage?: Message;
  }) => Promise<void>,
): Promise<void> {
  if (!isAllowedUser(cfg, interaction.user.id)) {
    await interaction.reply({
      content: "許可されていないユーザーです。",
      ephemeral: true,
    });
    return;
  }
  if (!isAllowedChannel(cfg, interaction.channel)) {
    await interaction.reply({
      content: "このチャンネルでは応答しません。",
      ephemeral: true,
    });
    return;
  }

  const key = sessionKeyForUser(interaction.user.id, interaction.channel);
  const name = interaction.commandName;
  const opt = (n: string) => interaction.options.getString(n) ?? undefined;

  if (name === "new") {
    const a = active.get(key);
    if (a) {
      a.queue.length = 0;
      if (a.run.supports("cancel")) await a.run.cancel().catch(() => {});
      active.delete(key);
    }
    busy.delete(key);
    const prev = await clearSessionKey(cfg.dataDir, key);
    await interaction.reply(
      prev
        ? `セッションを破棄しました（旧 \`${prev.agentId}\`）。次のメッセージで新規 create します。\n※ MEMORY/USER/skills は残ります。`
        : "破棄するセッションはありませんでした。次のメッセージで新規 create します。",
    );
    return;
  }

  if (name === "memory") {
    await interaction.deferReply();
    const action = opt("action") || "show";
    const id = opt("id");
    if (action === "show") {
      await replyInteraction(interaction, await formatMemorySummary(cfg.dataDir));
      return;
    }
    if (action === "pending") {
      const pending = (await listPending(cfg.dataDir)).filter((p) => p.kind === "memory");
      await replyInteraction(
        interaction,
        pending.length
          ? pending.map((p) => `- \`${p.id}\` ${p.action}: ${p.summary}`).join("\n")
          : "_no pending memory_",
      );
      return;
    }
    if (action === "approval") {
      const on = id === "on";
      if (id !== "on" && id !== "off") {
        await replyInteraction(interaction, "id に on|off を指定してください");
        return;
      }
      await updateSettings(cfg.dataDir, { memoryWriteApproval: on });
      await replyInteraction(interaction, `memory write_approval = ${on}`);
      return;
    }
    if (action === "approve") {
      const msg =
        id === "all"
          ? await approveAll(cfg.dataDir)
          : (await applyPending(cfg.dataDir, id || "")).message;
      await replyInteraction(interaction, msg);
      return;
    }
    if (action === "reject") {
      await replyInteraction(
        interaction,
        (await rejectPending(cfg.dataDir, id || "all")).message,
      );
      return;
    }
  }

  if (name === "skills") {
    await interaction.deferReply();
    const action = opt("action") || "list";
    const id = opt("id");
    if (action === "list") {
      await replyInteraction(interaction, await formatSkillsSummary(cfg.dataDir));
      return;
    }
    if (action === "install") {
      if (!id) {
        await replyInteraction(interaction, "id に URL またはパスを指定");
        return;
      }
      try {
        const r = await installSkillFromSource(cfg.dataDir, id, opt("name"));
        await replyInteraction(interaction, `installed **${r.name}**`);
      } catch (err) {
        await replyInteraction(
          interaction,
          `install failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }
    if (action === "pending") {
      const pending = (await listPending(cfg.dataDir)).filter((p) => p.kind === "skill");
      await replyInteraction(
        interaction,
        pending.length
          ? pending.map((p) => `- \`${p.id}\` ${p.action}: ${p.summary}`).join("\n")
          : "_no pending skills_",
      );
      return;
    }
    if (action === "approval") {
      const on = id === "on";
      if (id !== "on" && id !== "off") {
        await replyInteraction(interaction, "id に on|off を指定");
        return;
      }
      await updateSettings(cfg.dataDir, { skillsWriteApproval: on });
      await replyInteraction(interaction, `skills write_approval = ${on}`);
      return;
    }
    if (action === "approve") {
      const msg =
        id === "all"
          ? await approveAll(cfg.dataDir)
          : (await applyPending(cfg.dataDir, id || "")).message;
      await replyInteraction(interaction, msg);
      return;
    }
    if (action === "reject") {
      await replyInteraction(
        interaction,
        (await rejectPending(cfg.dataDir, id || "all")).message,
      );
      return;
    }
  }

  if (name === "search") {
    await interaction.deferReply();
    const q = opt("query") || "";
    const hits = searchMessages(cfg.dataDir, q, { limit: 8 });
    if (!hits.length) {
      await replyInteraction(interaction, "ヒットなし");
      return;
    }
    const body = hits
      .map(
        (h) =>
          `- **${h.sessionKey}** (${h.role} ${h.createdAt})\n  ${h.body.slice(0, 200)}`,
      )
      .join("\n");
    await replyInteraction(interaction, body);
    return;
  }

  if (name === "stop") {
    const a = active.get(key);
    if (!a) {
      await interaction.reply({ content: "実行中のターンはありません。", ephemeral: true });
      return;
    }
    a.queue.length = 0;
    if (a.run.supports("cancel")) await a.run.cancel();
    await interaction.reply("中断しました。");
    return;
  }

  if (name === "retry") {
    const store = await loadSessionStore(cfg.dataDir);
    const last = store[key]?.lastUserText;
    if (!last) {
      await interaction.reply({ content: "再送する直前発話がありません。", ephemeral: true });
      return;
    }
    await interaction.deferReply();
    await runTurn({
      key,
      userId: interaction.user.id,
      channel: interaction.channel!,
      text: last,
      reply: (c) => replyInteraction(interaction, c),
      statusTarget: interaction,
    });
    return;
  }

  if (name === "undo") {
    deleteLastExchange(cfg.dataDir, key);
    const store = await loadSessionStore(cfg.dataDir);
    delete store[key];
    await saveSessionStore(cfg.dataDir, store);
    await interaction.reply(
      "直前交換をローカル FTS から削除し、Cursor セッションをリセットしました（SDK は外科的 undo 非対応）。",
    );
    return;
  }

  if (name === "title") {
    const title = opt("name")?.trim();
    const store = await loadSessionStore(cfg.dataDir);
    const meta = store[key];
    if (!title) {
      await interaction.reply(meta?.title ? `現在のタイトル: ${meta.title}` : "タイトル未設定");
      return;
    }
    if (!meta) {
      await interaction.reply("先に一度会話してください。");
      return;
    }
    meta.title = title;
    store[key] = meta;
    await saveSessionStore(cfg.dataDir, store);
    namedIndex.set(title, { key, agentId: meta.agentId });
    await interaction.reply(`タイトルを「${title}」に設定しました。`);
    return;
  }

  if (name === "sessions") {
    const store = await loadSessionStore(cfg.dataDir);
    const lines = Object.entries(store)
      .filter(([, m]) => m.title)
      .map(([k, m]) => `- **${m.title}** (\`${k}\` turns=${m.turns})`);
    await interaction.reply(lines.length ? lines.join("\n") : "_no titled sessions_");
    return;
  }

  if (name === "resume") {
    const title = opt("name")!.trim();
    const store = await loadSessionStore(cfg.dataDir);
    const found = Object.entries(store).find(([, m]) => m.title === title);
    if (!found) {
      await interaction.reply(`セッション「${title}」が見つかりません。`);
      return;
    }
    const [srcKey, meta] = found;
    store[key] = { ...meta };
    if (srcKey !== key) {
      // keep title on both
    }
    await saveSessionStore(cfg.dataDir, store);
    await interaction.reply(`「${title}」をこのチャット鍵に紐付けました。`);
    return;
  }

  if (name === "personality") {
    const n = opt("name");
    if (!n || n === "list") {
      const list = await listPersonalities(cfg.dataDir);
      await interaction.reply(
        list.length ? list.map((x) => `- ${x}`).join("\n") : "_no personalities_ (data/personalities/*.md)",
      );
      return;
    }
    const s = await loadSettings(cfg.dataDir);
    s.personalityBySession[key] = n;
    await updateSettings(cfg.dataDir, { personalityBySession: s.personalityBySession });
    const store = await loadSessionStore(cfg.dataDir);
    delete store[key];
    await saveSessionStore(cfg.dataDir, store);
    await interaction.reply(`personality=${n}（次回メッセージで新セッション）`);
    return;
  }

  if (name === "model") {
    const n = opt("name");
    const s = await loadSettings(cfg.dataDir);
    if (!n) {
      const cur = s.modelBySession[key] || cfg.modelId;
      await interaction.reply(
        `現在のモデル: \`${formatModelLabel(cur, cfg.modelFast)}\``,
      );
      return;
    }
    s.modelBySession[key] = n;
    await updateSettings(cfg.dataDir, { modelBySession: s.modelBySession });
    const store = await loadSessionStore(cfg.dataDir);
    delete store[key];
    await saveSessionStore(cfg.dataDir, store);
    await interaction.reply(
      `モデルを \`${formatModelLabel(n, cfg.modelFast)}\` に切替（次回 create）`,
    );
    return;
  }

  if (name === "usage") {
    const store = await loadSessionStore(cfg.dataDir);
    const meta = store[key];
    const model = await resolveModel(cfg, cfg.dataDir, key);
    const label = formatModelLabel(model, cfg.modelFast);
    if (!meta) {
      await interaction.reply(`model=\`${label}\` — まだセッションなし`);
      return;
    }
    const inn = meta.inputTokens ?? "?";
    const out = meta.outputTokens ?? "?";
    await interaction.reply(
      `model=\`${label}\` turns=${meta.turns} inputTokens~=${inn} outputTokens~=${out}\n(詳細は Cursor ダッシュボード SDK タグも参照)`,
    );
    return;
  }

  if (name === "sethome") {
    const ch = interaction.channel;
    if (!ch) {
      await interaction.reply("チャンネルが取得できません。");
      return;
    }
    await updateSettings(cfg.dataDir, {
      home: { channelId: ch.id, guildId: interaction.guildId },
    });
    await interaction.reply(`ホームを <#${ch.id}> に設定しました。`);
    return;
  }

  if (name === "reload-mcp") {
    const s = await loadSettings(cfg.dataDir);
    await updateSettings(cfg.dataDir, { mcpGeneration: s.mcpGeneration + 1 });
    const store = await loadSessionStore(cfg.dataDir);
    delete store[key];
    await saveSessionStore(cfg.dataDir, store);
    await interaction.reply(
      "MCP generation を更新しました。このセッションは次回メッセージで再 create されます（data/mcp.json / MCP_SERVERS_JSON）。",
    );
    return;
  }

  if (name === "cron") {
    await interaction.deferReply();
    const action = opt("action")!;
    if (action === "list") {
      const jobs = await loadCronJobs(cfg.dataDir);
      await replyInteraction(
        interaction,
        jobs.length
          ? jobs
              .map(
                (j) =>
                  `- \`${j.id}\` **${j.name}** ${j.paused ? "⏸" : "▶"} \`${j.schedule}\` next=${j.nextRunAt}`,
              )
              .join("\n")
          : "_no jobs_",
      );
      return;
    }
    if (action === "create") {
      const schedule = opt("schedule");
      const prompt = opt("prompt");
      if (!schedule || !prompt) {
        await replyInteraction(interaction, "schedule と prompt が必要です");
        return;
      }
      const job = await createCronJob(cfg.dataDir, {
        name: opt("name") || "job",
        schedule,
        prompt,
        channelId: interaction.channelId,
      });
      await replyInteraction(interaction, `created \`${job.id}\` next=${job.nextRunAt}`);
      return;
    }
    const id = opt("id");
    if (!id) {
      await replyInteraction(interaction, "id が必要です");
      return;
    }
    if (action === "remove") {
      await replyInteraction(
        interaction,
        (await removeCronJob(cfg.dataDir, id)) ? "removed" : "not found",
      );
      return;
    }
    if (action === "pause") {
      await updateCronJob(cfg.dataDir, id, { paused: true });
      await replyInteraction(interaction, "paused");
      return;
    }
    if (action === "resume") {
      await updateCronJob(cfg.dataDir, id, { paused: false });
      await replyInteraction(interaction, "resumed");
      return;
    }
    if (action === "run") {
      await updateCronJob(cfg.dataDir, id, {
        nextRunAt: new Date(0).toISOString(),
      });
      await replyInteraction(interaction, "queued for next tick (~30s)");
      return;
    }
  }

  if (name === "voice") {
    const action = opt("action")!;
    if (action === "join") {
      const member = interaction.guild?.members.cache.get(interaction.user.id);
      if (!member) {
        await interaction.reply("ギルドメンバーが取得できません。");
        return;
      }
      await interaction.deferReply();
      try {
        const msg = await vcJoin(client, member, cfg.dataDir, {
          onTranscript: async (userId, text) => {
            if (!isAllowedUser(cfg, userId)) return "";
            let answer = "";
            await runTurn({
              key: sessionKeyForUser(userId, interaction.channel),
              userId,
              channel: interaction.channel!,
              text,
              reply: async (c) => {
                answer = c;
              },
            });
            return answer;
          },
        });
        await replyInteraction(interaction, msg);
      } catch (err) {
        await replyInteraction(
          interaction,
          `VC error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }
    if (action === "leave") {
      await interaction.reply(
        interaction.guildId ? vcLeave(interaction.guildId) : "guild 外では不可",
      );
      return;
    }
    if (action === "status") {
      const s = await loadSettings(cfg.dataDir);
      const vc = interaction.guildId ? vcStatus(interaction.guildId) : "n/a";
      await interaction.reply(`voiceMode=${s.voiceMode}; ${vc}`);
      return;
    }
    const map: Record<string, VoiceMode> = {
      off: "off",
      on: "voice_only",
      tts: "tts",
    };
    const mode = map[action];
    if (!mode) {
      await interaction.reply("unknown action");
      return;
    }
    await updateSettings(cfg.dataDir, { voiceMode: mode });
    await interaction.reply(`voiceMode=${mode}`);
    return;
  }

  if (name === "background") {
    const prompt = opt("prompt")!;
    await interaction.reply("バックグラウンドで実行中…");
    const model = await resolveModel(cfg, cfg.dataDir, key);
    runEphemeralPrompt(agentOpts(cfg, model), prompt)
      .then(async (text) => {
        await interaction.followUp(`🧵 background:\n${text.slice(0, 1800)}`);
      })
      .catch(async (err) => {
        await interaction
          .followUp(`background failed: ${err instanceof Error ? err.message : String(err)}`)
          .catch(() => {});
      });
    return;
  }

  if (name === "approve") {
    const id = opt("id")!;
    const msg =
      id === "all"
        ? await approveAll(cfg.dataDir)
        : (await applyPending(cfg.dataDir, id)).message;
    await interaction.reply(
      `${msg}\n\n_Note: Cursor SDK はシェル危険コマンドのホスト側承認イベントを露出しないため、/approve は memory/skills pending のみ対象です。_`,
    );
    return;
  }

  if (name === "deny") {
    await interaction.reply((await rejectPending(cfg.dataDir, opt("id")!)).message);
    return;
  }

  if (name === "honcho") {
    const action = opt("action") || "list";
    if (action === "add") {
      const trait = opt("trait");
      if (!trait) {
        await interaction.reply("trait が必要です");
        return;
      }
      await addTrait(cfg.dataDir, trait);
      await interaction.reply("trait を追加しました");
      return;
    }
    await interaction.reply(await formatUserModel(cfg.dataDir));
    return;
  }
}

export async function startDiscordBot(cfg: AppConfig): Promise<Client> {
  await ensureMemoryLayout(cfg.dataDir);
  await ensureSkillsLayout(cfg.dataDir);
  await ensureSoulLayout(cfg.dataDir);
  await ensureWorkspace(cfg.agentCwd);
  openSearchDb(cfg.dataDir);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel],
  });

  const busy = new Set<string>();
  const active = new Map<string, Active>();
  const namedIndex = new Map<string, { key: string; agentId: string }>();

  const runTurn = async (args: {
    key: string;
    userId: string;
    channel: TextBasedChannel;
    text: string;
    reply: (content: string) => Promise<void>;
    statusTarget?: Message | ChatInputCommandInteraction;
    attachmentsMessage?: Message;
  }) => {
    if (busy.has(args.key)) {
      const a = active.get(args.key);
      if (a) {
        a.queue.push(args.text);
        if (a.run.supports("cancel")) await a.run.cancel().catch(() => {});
        await args.reply("割り込みを受け付けました（現在ターンを中断して結合します）。");
        return;
      }
      await args.reply("まだ前のターンを処理中です。");
      return;
    }
    busy.add(args.key);

    const statusRef: { msg: Message | null } = { msg: null };
    let lastStatus = "";
    const onProgress = async (line: string) => {
      if (line === lastStatus) return;
      lastStatus = line;
      try {
        if (!statusRef.msg && "send" in args.channel) {
          statusRef.msg = await (
            args.channel as { send: (c: string) => Promise<Message> }
          ).send(`⏳ ${line}`);
        } else if (statusRef.msg) {
          await statusRef.msg.edit(`⏳ ${line}`);
        }
      } catch {
        // ignore
      }
    };

    try {
      if ("sendTyping" in args.channel) {
        await args.channel.sendTyping().catch(() => {});
      }

      let text = args.text;
      let images: Array<{ data: string; mimeType: string }> | undefined;
      if (args.attachmentsMessage) {
        const prepared = await prepareMessageAttachments(
          args.attachmentsMessage,
          cfg.agentCwd,
        );
        text += prepared.promptExtra;
        images = prepared.images.length ? prepared.images : undefined;

        const voiceAtt = [...args.attachmentsMessage.attachments.values()].find(
          isVoiceAttachment,
        );
        if (voiceAtt) {
          const vcfg = voiceConfigFromEnv();
          if (vcfg) {
            const dir = path.join(cfg.agentCwd, "attachments", args.attachmentsMessage.id);
            const dest = path.join(dir, voiceAtt.name.replace(/[^\w.\-]+/g, "_"));
            await fs.mkdir(dir, { recursive: true });
            const res = await fetch(voiceAtt.url);
            await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
            const wav = await toWavIfNeeded(dest, dir);
            const transcript = await transcribeFile(vcfg, wav);
            if (transcript) text = `${text}\n\n[Voice transcript]\n${transcript}`.trim();
          } else {
            text += "\n\n[Voice attachment present but VOICE_API_KEY/OPENAI_API_KEY unset]";
          }
        }
      }

      const store = await loadSessionStore(cfg.dataDir);
      const meta = store[args.key];
      const modelId = await resolveModel(cfg, cfg.dataDir, args.key);
      const { agent, resumed } = await openAgent(
        agentOpts(cfg, modelId),
        meta?.agentId,
      );

      try {
        const isFirst = !resumed || !meta || meta.turns === 0;
        let combined = text;
        const { text: answer, usage } = await runUserTurn(
          agent,
          cfg.dataDir,
          combined,
          isFirst,
          {
            sessionKey: args.key,
            images,
            onProgress,
            registerRun: (run) => {
              active.set(args.key, { run, queue: [] });
            },
          },
        );

        const queued = active.get(args.key)?.queue ?? [];
        active.delete(args.key);

        let finalAnswer = answer;
        if (queued.length) {
          const follow = queued.join("\n");
          const second = await runUserTurn(agent, cfg.dataDir, follow, false, {
            sessionKey: args.key,
            onProgress,
            registerRun: (run) => {
              active.set(args.key, { run, queue: [] });
            },
          });
          active.delete(args.key);
          finalAnswer = `${answer}\n\n---\n${second.text}`;
          combined = `${combined}\n${follow}`;
        }

        if (statusRef.msg) await statusRef.msg.delete().catch(() => {});

        const latestAfter = await loadSessionStore(cfg.dataDir);
        const clearedMidTurn = Boolean(meta?.agentId && !latestAfter[args.key]);
        if (clearedMidTurn) {
          console.warn(
            `session ${args.key} cleared during turn (${meta?.agentId}); dropping reply`,
          );
          return;
        }

        await args.reply(finalAnswer);

        indexMessage(cfg.dataDir, args.key, "user", combined);
        indexMessage(cfg.dataDir, args.key, "assistant", finalAnswer);

        let reviewLine = "No memory changes";
        try {
          reviewLine = await runPostTurnReview(agent);
        } catch (err) {
          console.error("post-turn review failed:", err);
          reviewLine = "Review failed";
        }

        const nextMeta: SessionMeta = {
          agentId: agent.agentId,
          turns: (meta?.turns ?? 0) + 1,
          title: meta?.title,
          lastUserText: combined,
          inputTokens: (meta?.inputTokens ?? 0) + (usage?.input ?? 0),
          outputTokens: (meta?.outputTokens ?? 0) + (usage?.output ?? 0),
        };
        const saved = await commitSessionMeta(
          cfg.dataDir,
          args.key,
          meta?.agentId,
          nextMeta,
        );
        if (!saved) {
          console.warn(
            `session ${args.key} was cleared/replaced during turn; not writing ${agent.agentId}`,
          );
        }

        if (cfg.memoryNotifications === "on") {
          await args.reply(`💾 ${reviewLine}`);
        }

        const settings = await loadSettings(cfg.dataDir);
        if (settings.voiceMode === "tts" || (settings.voiceMode === "voice_only" && args.attachmentsMessage && [...args.attachmentsMessage.attachments.values()].some(isVoiceAttachment))) {
          const vcfg = voiceConfigFromEnv();
          if (vcfg && "send" in args.channel) {
            try {
              const out = path.join(cfg.dataDir, "voice-tmp", `reply-${Date.now()}.mp3`);
              await synthesizeSpeech(vcfg, finalAnswer.slice(0, 1500), out);
              await args.channel.send({
                files: [new AttachmentBuilder(out)],
              });
            } catch (err) {
              console.error("tts reply:", err);
            }
          }
        }
      } finally {
        await agent.close();
      }
    } catch (err) {
      console.error(err);
      await args.reply(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      active.delete(args.key);
      busy.delete(args.key);
    }
  };

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`discord ready as ${readyClient.user.tag}`);
    console.log(`model ${formatModelLabel(cfg.modelId, cfg.modelFast)}`);
    try {
      await registerSlashCommands(cfg, readyClient.application.id);
    } catch (err) {
      console.error("failed to register slash commands:", err);
    }

    const settings = await loadSettings(cfg.dataDir);
    if (settings.home?.channelId && cfg.homeNotifyOnStart) {
      try {
        const ch = await readyClient.channels.fetch(settings.home.channelId);
        if (ch && ch.isTextBased() && "send" in ch) {
          await ch.send("🟢 cursor-discord-agent online");
        }
      } catch (err) {
        console.error("home notify failed:", err);
      }
    }

    startCronScheduler({
      dataDir: cfg.dataDir,
      deliver: async (channelId, text) => {
        const ch = await readyClient.channels.fetch(channelId);
        if (ch && ch.isTextBased() && "send" in ch) {
          await sendChunked((c) => ch.send(c), text);
        }
      },
      runAgent: async (prompt) =>
        runEphemeralPrompt(agentOpts(cfg, cfg.modelId), prompt),
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      await handleSlash(
        cfg,
        client,
        interaction,
        busy,
        active,
        namedIndex,
        runTurn,
      );
    } catch (err) {
      console.error(err);
      const msg = `エラー: ${err instanceof Error ? err.message : String(err)}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!isAllowedUser(cfg, message.author.id)) return;
    if (!isAllowedChannel(cfg, message.channel)) return;

    const botUser = client.user;
    if (!botUser) return;

    if (cfg.requireMention) {
      if (!message.mentions.users.has(botUser.id)) return;
    }

    let text = message.content.trim();
    if (cfg.requireMention || message.mentions.users.has(botUser.id)) {
      text = stripBotMentions(text, botUser.id);
    }

    const hasAtt = message.attachments.size > 0;
    if (!text && !hasAtt) return;

    if (text === "/new") {
      const key = sessionKeyForUser(message.author.id, message.channel);
      const a = active.get(key);
      if (a) {
        a.queue.length = 0;
        if (a.run.supports("cancel")) await a.run.cancel().catch(() => {});
        active.delete(key);
      }
      busy.delete(key);
      const prev = await clearSessionKey(cfg.dataDir, key);
      await message.reply(
        prev
          ? `セッションを破棄しました（旧 \`${prev.agentId}\`）。次のメッセージで新規 create します。\n※ MEMORY/USER/skills は残ります。`
          : "破棄するセッションはありませんでした。次のメッセージで新規 create します。",
      );
      return;
    }

    if (text.startsWith("/")) {
      await message.reply(
        "スラッシュコマンドは Discord の Application Command UI から実行してください（例外: チャットの `/new` はセッション破棄します）。",
      );
      return;
    }

    const key = sessionKeyForUser(message.author.id, message.channel);
    await runTurn({
      key,
      userId: message.author.id,
      channel: message.channel,
      text: text || "(attachment only)",
      reply: (c) => replyMessage(message, c),
      attachmentsMessage: message,
    });
  });

  await client.login(cfg.discordBotToken);
  return client;
}
