# Cursor Discord Agent

Discord 入口 + Cursor SDK（ローカル agent）+ Hermes 風 MEMORY/USER/skills 学習ループ。

## 必要なもの

- Node.js ≥ 22.13（ローカル開発）
- Docker / Compose（常駐）
- [Cursor API key](https://cursor.com/dashboard/integrations)
- Discord Bot Token（Message Content Intent を有効化。スラッシュコマンド用に Bot をサーバーへ招待）

## セットアップ

```bash
cp .env.example .env
# CURSOR_API_KEY / DISCORD_BOT_TOKEN / DISCORD_ALLOWED_USER_IDS / TS_AUTHKEY を埋める
mkdir -p data workspace
npm ci
npm run check:memory
npm run check:mcp
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

Bot は Discord へ outbound するだけなので、ホストへの inbound ポートは不要です。

## Discord コマンド

起動時に Application Command を登録します（Discord のスラッシュ UI）。

| コマンド | 意味 |
|----------|------|
| 通常メッセージ | Cursor agent に送信 → 返信 → 学習レビュー |
| `/new` | セッション（agentId）を破棄して次回 create |
| `/memory` | MEMORY.md / USER.md の現在内容 |
| `/skills` | skills 一覧 |

`DISCORD_GUILD_ID` を設定するとそのギルドへ即時登録、未設定ならグローバル登録（反映まで最大約1時間）。

| env | 意味 |
|-----|------|
| `DISCORD_ALLOWED_CHANNEL_IDS` | カンマ区切りのチャンネル ID。空なら全チャンネル。親チャンネルを書けばその下のスレッドも可 |
| `DISCORD_REQUIRE_MENTION` | `true` なら通常メッセージは `@Bot` メンション必須（スラッシュコマンドは不要）。既定 `false` |

セッション鍵: スレッド内なら `thread:<id>`、それ以外は `user:<discordUserId>`。

## 長文について

Discord は約 2000 字制限のため、ゲートウェイは返信を分割します。大きな成果物は agent に workspace へ書かせてください。

## 学習ループ

- セッション最初のターンで MEMORY/USER の frozen snapshot をプロンプト注入
- ターン中は memory-skills MCP（stdio）で書き込み可
- 毎ターン後にレビュー follow-up（MCP のみ触る指示）。`MEMORY_NOTIFICATIONS=on` なら `💾 …` を 1 行投稿

## SDK smoke（課金あり）

```bash
export CURSOR_API_KEY=...
npm run smoke:sdk
```
