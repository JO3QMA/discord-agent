# モデル ID（CURSOR_MODEL / Discord `/model`）

このゲートウェイは **`@cursor/sdk`** 経由。`cursor-agent models` の展開 slug（`grok-4.7-medium` など）は **そのまま SDK id に使えない**。

## 確認

- SDK 一覧: エージェント失敗時の `Available models`、または `Cursor.models.list()`
- CLI 一覧: `cursor-agent models`（effort/fast を slug に焼いた表示名）

## Grok 4.7

- **ベース id**: `grok-4.7`（`grok-4.7-medium` は不可）
- **env**: `CURSOR_MODEL=grok-4.7` + `CURSOR_MODEL_EFFORT=low|medium|high|xhigh` → SDK `reasoning_effort`
- **context**: `CURSOR_MODEL_CONTEXT=256k|500k`（省略時 **256k**）
- **fast**: `CURSOR_MODEL_FAST=false`
- `/model` に CLI slug（`grok-4.7-medium` 等）を入れた場合、ゲートウェイが `grok-4.7` + 相当 params に変換

## Grok 4.6 / 4.5

- **ベース id**: `grok-4.6` / `grok-4.5`
- **effort**: `CURSOR_MODEL_EFFORT` → SDK param `effort`（4.7 とは param 名が違う）

## Composer など

- `composer-2.5` + `CURSOR_MODEL_EFFORT` / `CURSOR_MODEL_FAST`（param 名 `effort`）

`data/skills/` は実行時データ（gitignore）。運用メモ用の skill 参照はリポジトリのこのファイルと重複してもよいが、**ドキュメントの正はリポジトリ内 `docs/`**。
