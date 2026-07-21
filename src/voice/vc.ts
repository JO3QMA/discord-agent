import {
  joinVoiceChannel,
  getVoiceConnection,
  EndBehaviorType,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import type { Client, GuildMember, VoiceBasedChannel } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import prism from "prism-media";
import {
  toWavIfNeeded,
  transcribeFile,
  synthesizeSpeech,
  voiceConfigFromEnv,
} from "./stt-tts.js";

export type VcCallbacks = {
  onTranscript: (userId: string, text: string) => Promise<string>;
};

const activeGuild = new Map<string, string>(); // guildId -> channelId

export function vcStatus(guildId: string): string {
  const ch = activeGuild.get(guildId);
  return ch ? `connected to channel ${ch}` : "not in a voice channel";
}

export async function vcJoin(
  _client: Client,
  member: GuildMember,
  dataDir: string,
  cbs: VcCallbacks,
): Promise<string> {
  const channel = member.voice.channel;
  if (!channel) return "先にボイスチャンネルへ参加してください。";
  const existing = getVoiceConnection(channel.guild.id);
  if (existing) existing.destroy();

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  activeGuild.set(channel.guild.id, channel.id);

  const receiver = connection.receiver;
  const cfg = voiceConfigFromEnv();
  const tmp = path.join(dataDir, "voice-tmp");
  fs.mkdirSync(tmp, { recursive: true });

  receiver.speaking.on("start", (userId) => {
    if (!cfg) return;
    const opus = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1500 },
    });
    const decoder = new prism.opus.Decoder({
      frameSize: 960,
      channels: 1,
      rate: 48000,
    });
    const pcmPath = path.join(tmp, `${userId}-${Date.now()}.pcm`);
    const out = createWriteStream(pcmPath);
    pipeline(opus, decoder, out)
      .then(async () => {
        const wav = await pcmToWav(pcmPath, tmp);
        const text = await transcribeFile(cfg, wav);
        if (!text.trim()) return;
        const reply = await cbs.onTranscript(userId, text);
        if (!reply.trim()) return;
        const mp3 = path.join(tmp, `tts-${Date.now()}.mp3`);
        await synthesizeSpeech(cfg, reply, mp3);
        await playFile(connection, mp3);
      })
      .catch((err) => console.error("vc listen:", err));
  });

  return `VC に参加しました: ${channel.name}`;
}

export function vcLeave(guildId: string): string {
  const conn = getVoiceConnection(guildId);
  if (!conn) return "VC に接続していません。";
  conn.destroy();
  activeGuild.delete(guildId);
  return "VC から切断しました。";
}

async function playFile(
  connection: ReturnType<typeof joinVoiceChannel>,
  file: string,
): Promise<void> {
  const player = createAudioPlayer();
  const resource = createAudioResource(file);
  connection.subscribe(player);
  player.play(resource);
  await entersState(player, AudioPlayerStatus.Playing, 5_000).catch(() => {});
  await entersState(player, AudioPlayerStatus.Idle, 120_000).catch(() => {});
}

async function pcmToWav(pcmPath: string, outDir: string): Promise<string> {
  // Write minimal WAV header for 48kHz mono s16le
  const pcm = fs.readFileSync(pcmPath);
  const wavPath = path.join(outDir, `${path.basename(pcmPath)}.wav`);
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(48000, 24);
  header.writeUInt32LE(48000 * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(wavPath, Buffer.concat([header, pcm]));
  return toWavIfNeeded(wavPath, outDir);
}

export type { VoiceBasedChannel };
