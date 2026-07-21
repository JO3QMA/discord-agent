import fs from "node:fs/promises";
import path from "node:path";

export type VoiceMode = "off" | "voice_only" | "tts";

export type GatewaySettings = {
  home?: { channelId: string; guildId?: string | null };
  memoryWriteApproval: boolean;
  skillsWriteApproval: boolean;
  voiceMode: VoiceMode;
  /** Bumped on /reload-mcp so callers know to recreate agents. */
  mcpGeneration: number;
  /** Per Operator key model override. */
  modelByOperator: Record<string, string>;
  /** Personality name under data/personalities, keyed by Operator. */
  personalityByOperator: Record<string, string>;
};

const DEFAULTS: GatewaySettings = {
  memoryWriteApproval: false,
  skillsWriteApproval: false,
  voiceMode: "off",
  mcpGeneration: 0,
  modelByOperator: {},
  personalityByOperator: {},
};

function settingsPath(dataDir: string): string {
  return path.join(dataDir, "gateway.json");
}

export async function loadSettings(dataDir: string): Promise<GatewaySettings> {
  try {
    const raw = await fs.readFile(settingsPath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<GatewaySettings>;
    return {
      ...DEFAULTS,
      ...parsed,
      modelByOperator: parsed.modelByOperator ?? {},
      personalityByOperator: parsed.personalityByOperator ?? {},
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(
  dataDir: string,
  settings: GatewaySettings,
): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    settingsPath(dataDir),
    JSON.stringify(settings, null, 2),
    "utf8",
  );
}

export async function updateSettings(
  dataDir: string,
  patch: Partial<GatewaySettings>,
): Promise<GatewaySettings> {
  const cur = await loadSettings(dataDir);
  const next = { ...cur, ...patch };
  await saveSettings(dataDir, next);
  return next;
}
