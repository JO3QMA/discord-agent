# 会話・セッション・実行ハンドル・Operator 鍵

**会話**は場所の対話単位。通常チャンネル／DM の鍵は `channel:<channelId>`（送信者を載せない）——同じチャンネルの許可 Operator は会話とセッションを共有する。分かれた話題は Thread を立てる。スレッド鍵は `thread:<threadId>`（参加者共有）。Cursor 側の対話コンテキストは **セッション**（`/new` で作り直し）。`agentId` は **実行ハンドル**。

個人に付帯する状態（人格・USER）は **Operator 鍵**（`user:<discordUserId>`）。OpenClaw のチャンネル共有に近く、Hermes 既定のチャンネル内 per-user 隔離とは違う（個人プロファイルは Operator 鍵で分離する）。

旧万能 `sessionKey` や `channel:…:user:…` 会話鍵は採らない。既存エントリは移行しない。
