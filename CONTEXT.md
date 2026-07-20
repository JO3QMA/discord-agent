# Cursor Discord Agent

Discord を入口とし、Cursor SDK を唯一のエージェント実行系とする個人／少人数向けゲートウェイ。Hermes 互換を目指さない。

## Language

**Discord Agent**:
Cursor SDK を脳とし、Discord を操作面とする本プロダクト。学習ループやメッセ UX は Hermes から借りた部品であって、製品カテゴリではない。
_Avoid_: Hermes 互換ゲートウェイ, Hermes clone, Hermes Discord

**Cursor Agent**:
Cursor SDK（`Agent.create` / `resume` / `send`）が駆動する実行実体。ツール実行・推論はこの中で完結する。
_Avoid_: LLM, model endpoint, Hermes agent process

**学習ループ**:
ターンをまたいで MEMORY / USER / Skill を育て、定着レビューで閉じていくループ。Discord Agent の本体の一角であり、無いとこのプロダクトではない。
_Avoid_: 記憶レイヤ（任意扱い）, memory feature, Hermes learning loop（製品名として）

**会話**:
Discord 上で続く対話の単位。同一性の核は Discord 側の鍵（`user:<id>` または `thread:<id>`）。学習ループの対象スコープでもある。
_Avoid_: セッション（曖昧）, Agent セッション（Cursor と同一視する場合）

**実行ハンドル**:
ある会話に紐づく Cursor Agent の一時的な参照（`agentId`）。付け替え可能で、コンテナ再作成などで消えうる。会話そのものではない。
_Avoid_: セッション, agent session（会話と同一視する場合）

**入口**:
Operator が Discord Agent と話す唯一の操作面。Discord（ギルド／DM／スレッド）に限る。
_Avoid_: マルチプラットフォームゲートウェイ, Telegram, Slack, WhatsApp, Hermes gateway（多チャネル）

**MEMORY**:
学習ループが持つ、環境・教訓・作業上の事実のキュレーション済みメモ。
_Avoid_: notes, knowledge base, User Model

**USER**:
学習ループが持つ、配置を共有する Operator 向けの好み・人物像のキュレーション済みプロファイル。
_Avoid_: profile, User Model, Honcho（別柱として扱う場合）

**Skill**:
学習ループが持つ、再利用可能な手順（`SKILL.md`）。agentskills.io 互換の形を取る。
_Avoid_: prompt template, custom command, plugin

**Operator**:
入口を通じて Discord Agent を操作してよい主体。許可された Discord ユーザーと一致する。
_Avoid_: 利用者（許可境界をぼかす場合）, Member, Owner（ロール分割が無い現状で）

**配置**:
一つのゲートウェイ稼働単位（一つの `DATA_DIR`）。学習ループ（MEMORY / USER / Skill）は配置内の全 Operator で共有する。作業ディレクトリとは別。
_Avoid_: テナント, Workspace（作業ディレクトリと混同）, Operator 私有メモリ

**定期ジョブ**:
スケジュールで発火し、会話履歴に載せず結果をホーム（または指定チャンネル）へ届ける実行。実行ハンドルは会話と共有しない。
_Avoid_: cron session, 会話の一種

**バックグラウンドターン**:
Operator が今の入口から撃つが、進行中の会話を塞がない派生実行。結果は元チャンネルへ戻り、実行ハンドルは会話本体と別。
_Avoid_: ジョブ（定期ジョブと同一視）, 会話（同一の実行ハンドルで進める場合）

**書き込み承認**:
学習ループへの MEMORY / USER / Skill の反映を、即時ではなく Operator の approve/reject 待ちにする配置オプション。既定は OFF。
_Avoid_: シェル承認（Cursor に無い能力）, dangerous command approval

**人格**:
Operator が手置きする声・口調の設定（`SOUL.md` / personality）。学習ループの外にあり、エージェントは自動では書き換えない。
_Avoid_: USER（学習対象のプロファイル）, 第4の記憶柱

**ホーム**:
配置あたり一つの既定 Discord チャンネル。定期ジョブの宛先が無いときの届け先、および起動通知の届け先。会話そのものではない。
_Avoid_: ホーム会話, デフォルトセッション

**作業ディレクトリ**:
Cursor Agent の cwd（`AGENT_CWD`）。コードや成果物用。学習ループの永続ファイル（MEMORY / USER / Skill 等）はここには置かない。
_Avoid_: Workspace（配置と混同）, 配置と同一の木

**定着レビュー**:
会話の各ターン後に走る学習ループの締め。MEMORY / USER / Skill への反映を検討する。学習ループの一部で既定 ON。入口への 💾 通知は別オプション。
_Avoid_: 任意フック, ただのフォローアップメッセージ

**会話ログ**:
会話の発話を検索可能に残した生ログ（FTS）。想起・横断検索用であり、キュレーション済みの MEMORY / USER / Skill とは別物。
_Avoid_: MEMORY, 学習ループの一部（同一視する場合）

**会話タイトル**:
会話に付ける人間可読ラベル。同一性の核は Discord 鍵のままで、タイトルは検索・切替のための名前にすぎない。
_Avoid_: 別名会話（タイトルを同一性の核にする場合）, セッション名（曖昧）
