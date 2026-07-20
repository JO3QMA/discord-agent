import path from "node:path";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function parseIdList(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function parseAllowedUserIds(raw: string): Set<string> {
  const ids = parseIdList(raw);
  if (ids.size === 0) {
    throw new Error("DISCORD_ALLOWED_USER_IDS must list at least one Discord user id");
  }
  return ids;
}

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  throw new Error(`invalid boolean ${JSON.stringify(raw)}; use true/false`);
}

export type AppConfig = {
  cursorApiKey: string;
  discordBotToken: string;
  allowedUserIds: Set<string>;
  /**
   * When non-empty, only these channel IDs (or threads under them) are handled.
   * Empty = all channels.
   */
  allowedChannelIds: Set<string>;
  /** When true, guild/DM messages must @mention the bot to trigger the agent. */
  requireMention: boolean;
  /** When set, slash commands register to this guild (instant). Otherwise global. */
  discordGuildId: string | null;
  dataDir: string;
  agentCwd: string;
  modelId: string;
  memoryNotifications: "off" | "on";
  /** Send a message to /sethome channel on gateway start. */
  homeNotifyOnStart: boolean;
};

export function loadConfig(): AppConfig {
  const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");
  const agentCwd = path.resolve(process.env.AGENT_CWD ?? "./workspace");
  const notif = (process.env.MEMORY_NOTIFICATIONS ?? "on").toLowerCase();
  if (notif !== "off" && notif !== "on") {
    throw new Error("MEMORY_NOTIFICATIONS must be off|on");
  }
  const guildId = process.env.DISCORD_GUILD_ID?.trim() || null;
  return {
    cursorApiKey: requireEnv("CURSOR_API_KEY"),
    discordBotToken: requireEnv("DISCORD_BOT_TOKEN"),
    allowedUserIds: parseAllowedUserIds(requireEnv("DISCORD_ALLOWED_USER_IDS")),
    allowedChannelIds: parseIdList(process.env.DISCORD_ALLOWED_CHANNEL_IDS),
    requireMention: parseBool(process.env.DISCORD_REQUIRE_MENTION, false),
    discordGuildId: guildId,
    dataDir,
    agentCwd,
    modelId: process.env.CURSOR_MODEL?.trim() || "composer-2.5",
    memoryNotifications: notif,
    homeNotifyOnStart: parseBool(process.env.HOME_NOTIFY_ON_START, true),
  };
}

export function dataPaths(dataDir: string) {
  return {
    memoriesDir: path.join(dataDir, "memories"),
    memoryFile: path.join(dataDir, "memories", "MEMORY.md"),
    userFile: path.join(dataDir, "memories", "USER.md"),
    skillsDir: path.join(dataDir, "skills"),
    sessionsFile: path.join(dataDir, "sessions.json"),
  };
}
