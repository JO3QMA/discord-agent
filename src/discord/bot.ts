import {
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
import type { AppConfig } from "../config.js";
import { runPostTurnReview } from "../agent/review.js";
import {
  loadSessionStore,
  openAgent,
  runUserTurn,
  saveSessionStore,
} from "../agent/session.js";
import { ensureMemoryLayout, formatMemorySummary } from "../memory/store.js";
import { ensureSkillsLayout, formatSkillsSummary } from "../skills/store.js";
import fs from "node:fs/promises";

const slashCommands = [
  new SlashCommandBuilder()
    .setName("new")
    .setDescription("エージェントセッションを破棄し、次のメッセージで新規作成する"),
  new SlashCommandBuilder()
    .setName("memory")
    .setDescription("MEMORY.md / USER.md の現在内容を表示する"),
  new SlashCommandBuilder()
    .setName("skills")
    .setDescription("インストール済み skills を一覧表示する"),
].map((c) => c.toJSON());

function sessionKeyForUser(userId: string, channel: TextBasedChannel | null): string {
  if (channel?.isThread()) return `thread:${channel.id}`;
  return `user:${userId}`;
}

function isAllowedUser(cfg: AppConfig, userId: string): boolean {
  return cfg.allowedUserIds.has(userId);
}

/** Empty allowlist = all channels. Threads match if thread id or parent id is listed. */
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
    await rest.put(
      Routes.applicationGuildCommands(applicationId, cfg.discordGuildId),
      { body: slashCommands },
    );
    console.log(`slash commands registered for guild ${cfg.discordGuildId}`);
    return;
  }
  await rest.put(Routes.applicationCommands(applicationId), {
    body: slashCommands,
  });
  console.log("slash commands registered globally (may take up to ~1h to appear)");
}

async function handleSlash(
  cfg: AppConfig,
  interaction: ChatInputCommandInteraction,
  busy: Set<string>,
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

  if (name === "new") {
    if (busy.has(key)) {
      await interaction.reply({
        content: "まだ前のターンを処理中です。少し待ってください。",
        ephemeral: true,
      });
      return;
    }
    const store = await loadSessionStore(cfg.dataDir);
    delete store[key];
    await saveSessionStore(cfg.dataDir, store);
    await interaction.reply(
      "新しいエージェントセッションを開始します（次のメッセージで create）。",
    );
    return;
  }

  if (name === "memory") {
    await interaction.deferReply();
    await replyInteraction(interaction, await formatMemorySummary(cfg.dataDir));
    return;
  }

  if (name === "skills") {
    await interaction.deferReply();
    await replyInteraction(interaction, await formatSkillsSummary(cfg.dataDir));
    return;
  }
}

export async function startDiscordBot(cfg: AppConfig): Promise<Client> {
  await ensureMemoryLayout(cfg.dataDir);
  await ensureSkillsLayout(cfg.dataDir);
  await ensureWorkspace(cfg.agentCwd);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  const busy = new Set<string>();

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`discord ready as ${readyClient.user.tag}`);
    try {
      await registerSlashCommands(cfg, readyClient.application.id);
    } catch (err) {
      console.error("failed to register slash commands:", err);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      await handleSlash(cfg, interaction, busy);
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
    if (!text) return;

    // Slash commands are Application Commands; ignore legacy text "/…" so they
    // don't get forwarded to the agent as a normal prompt.
    if (text === "/new" || text === "/memory" || text === "/skills") {
      await message.reply(
        "スラッシュコマンドを使ってください（`/new` `/memory` `/skills`）。",
      );
      return;
    }

    const key = sessionKeyForUser(message.author.id, message.channel);
    if (busy.has(key)) {
      await message.reply("まだ前のターンを処理中です。少し待ってください。");
      return;
    }
    busy.add(key);

    try {
      if ("sendTyping" in message.channel) {
        await message.channel.sendTyping().catch(() => {});
      }

      const store = await loadSessionStore(cfg.dataDir);
      const meta = store[key];
      const agent = await openAgent(
        {
          apiKey: cfg.cursorApiKey,
          modelId: cfg.modelId,
          dataDir: cfg.dataDir,
          agentCwd: cfg.agentCwd,
        },
        meta?.agentId,
      );

      try {
        const isFirst = !meta || meta.turns === 0;
        const answer = await runUserTurn(agent, cfg.dataDir, text, isFirst);
        await replyMessage(message, answer);

        let reviewLine = "No memory changes";
        try {
          reviewLine = await runPostTurnReview(agent);
        } catch (err) {
          console.error("post-turn review failed:", err);
          reviewLine = "Review failed";
        }

        store[key] = {
          agentId: agent.agentId,
          turns: (meta?.turns ?? 0) + 1,
        };
        await saveSessionStore(cfg.dataDir, store);

        if (cfg.memoryNotifications === "on") {
          await message.reply(`💾 ${reviewLine}`);
        }
      } finally {
        await agent.close();
      }
    } catch (err) {
      console.error(err);
      await message.reply(
        `エラー: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      busy.delete(key);
    }
  });

  await client.login(cfg.discordBotToken);
  return client;
}
