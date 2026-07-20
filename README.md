# Cursor Discord Agent

Discord 入口 + Cursor SDK（ローカル agent）+ Hermes 風 MEMORY/USER/skills 学習ループ。

## 必要なもの

- Node.js ≥ 22.13（ローカル開発。`node:sqlite` FTS5 を使用）
- Docker / Compose（常駐）
- [Cursor API key](https://cursor.com/dashboard/integrations)
- Discord Bot Token（Message Content Intent・Voice を使うなら Voice 関連権限も）

## セットアップ

```bash
cp .env.example .env
# CURSOR_API_KEY / DISCORD_BOT_TOKEN / DISCORD_ALLOWED_USER_IDS / TS_AUTHKEY を埋める
mkdir -p data workspace
npm ci
npm run check:memory
npm run check:search
npm run check:mcp
npm run check:session
```

## ローカル起動

```bash
npm run dev
```

## Docker（Tailscale 同居）

```bash
docker compose up -d --build
docker compose logs -f gateway
```

## Discord コマンド

| コマンド | 意味 |
|----------|------|
| 通常メッセージ | Cursor agent → 返信 → 学習レビュー（添付・音声メモ可） |
| `/new` | セッション破棄（実行中なら中断してから破棄。次メッセージで create） |
| `/memory` | 表示 / pending / approve / reject / approval on\|off |
| `/skills` | list / install / pending / approve / reject / approval |
| `/search` | 過去セッション FTS5 検索 |
| `/stop` `/retry` `/undo` | 中断・再送・ローカル undo + セッションリセット |
| `/title` `/sessions` `/resume` | 名前付きセッション |
| `/personality` | `data/personalities/*.md` + `SOUL.md` |
| `/model` `/usage` | モデル切替・概算トークン |
| `/sethome` | ホームチャンネル（起動通知・cron 既定宛先） |
| `/reload-mcp` | `data/mcp.json` / `MCP_SERVERS_JSON` を次回 create に反映 |
| `/cron` | スケジュールジョブ |
| `/voice` | on\|off\|tts\|status\|join\|leave |
| `/background` | 別セッション実行 |
| `/approve` `/deny` | pending 書き込み承認（shell 危険コマンドは対象外） |
| `/honcho` | ローカルユーザモデル |

Composer（`CURSOR_MODEL=composer-2.5`）は **params 省略時に SDK デフォルトが fast**。ゲートウェイは既定で `CURSOR_MODEL_FAST=false` を明示する。fast にしたいときだけ `true`。

`DISCORD_GUILD_ID` あり: ギルドへ即時登録し、**グローバルコマンドは空クリア**（二重表示防止）。なし: グローバルのみ（反映に最大約1時間）。

## 学習ループ / 追加機能

- セッション開始時: SOUL / personality / CONTEXT / Honcho / MEMORY / skills を注入
- ターン中: memory-skills MCP（memory, skills, session_search, cronjob, honcho_*）
- 毎ターン後レビュー + `💾` 通知
- 会話は `data/sessions.sqlite`（FTS5）へインデックス
- write_approval: `/memory approval on` 等でステージ → approve/reject
- Cron: `/cron` または MCP `cronjob`、配信はホーム or 作成チャンネル
- 追加 MCP: `data/mcp.json` または `MCP_SERVERS_JSON`
- Skills Hub: `/skills install` に SKILL.md の URL/パス
- 人格サンプル: `examples/personalities/friendly.md` → `data/personalities/friendly.md` にコピー
- 追加 MCP サンプル: `mcp.json.example` → `data/mcp.json`

## Cursor SDK 制約（#16）

Cursor SDK はシェル危険コマンドのホスト側承認イベントを露出しない。`/approve` `/deny` は **memory/skills の pending 書き込み** のみ。シェル承認は SDK 側の将来サポート待ち。

## セッションと `agent_not_found`

`data/sessions.json` の `agentId` は永続ボリュームに残りますが、ローカル SDK のエージェント実体はコンテナ内にあり、**イメージ再ビルドで消えます**。env ミスではなく、そのとき `Agent.resume` が `agent_not_found` になります。ゲートウェイは自動で新規 create にフォールバックします。手動なら Discord で `/new` でも可。

ExperimentalWarning（SQLite）は Node の `node:sqlite` に関する警告で、動作上の問題ではありません。

## Honcho（#17）

外部 Honcho は使わず、`data/honcho.json` のローカル trait ストア + MCP `honcho_trait` / `/honcho` で最小実装。

## 音声

`VOICE_API_KEY` または `OPENAI_API_KEY` が必要。VC は `@discordjs/voice` + opusscript。

## SDK smoke（課金あり）

```bash
export CURSOR_API_KEY=...
npm run smoke:sdk
```
