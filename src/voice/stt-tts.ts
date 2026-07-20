import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export type VoiceConfig = {
  /** OpenAI-compatible base, e.g. https://api.openai.com/v1 */
  apiBase: string;
  apiKey: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
};

export function voiceConfigFromEnv(): VoiceConfig | null {
  const apiKey =
    process.env.VOICE_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
  if (!apiKey) return null;
  return {
    apiBase: (process.env.VOICE_API_BASE || "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    ),
    apiKey,
    sttModel: process.env.VOICE_STT_MODEL?.trim() || "whisper-1",
    ttsModel: process.env.VOICE_TTS_MODEL?.trim() || "gpt-4o-mini-tts",
    ttsVoice: process.env.VOICE_TTS_VOICE?.trim() || "alloy",
  };
}

export async function transcribeFile(
  cfg: VoiceConfig,
  filePath: string,
): Promise<string> {
  const buf = await fs.readFile(filePath);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buf)]),
    path.basename(filePath),
  );
  form.append("model", cfg.sttModel);
  const res = await fetch(`${cfg.apiBase}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`STT failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

export async function synthesizeSpeech(
  cfg: VoiceConfig,
  text: string,
  outPath: string,
): Promise<string> {
  const res = await fetch(`${cfg.apiBase}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.ttsModel,
      voice: cfg.ttsVoice,
      input: text.slice(0, 4000),
    }),
  });
  if (!res.ok) {
    throw new Error(`TTS failed: ${res.status} ${await res.text()}`);
  }
  const ab = await res.arrayBuffer();
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, Buffer.from(ab));
  return outPath;
}

/** Best-effort local ffmpeg convert to wav for STT. */
export async function toWavIfNeeded(input: string, outDir: string): Promise<string> {
  if (input.toLowerCase().endsWith(".wav")) return input;
  const out = path.join(outDir, `${path.basename(input)}.wav`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      "ffmpeg",
      ["-y", "-i", input, "-ar", "16000", "-ac", "1", out],
      { stdio: "ignore" },
    );
    p.on("error", () => resolve()); // ponytail: no ffmpeg → send original
    p.on("close", (code) => (code === 0 ? resolve() : resolve()));
  });
  try {
    await fs.access(out);
    return out;
  } catch {
    return input;
  }
}
