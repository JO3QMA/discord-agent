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
Discord 上で続く対話の単位。同一性の核は場所である。通常チャンネル／DM では `channel:<channelId>`（同じ場所の許可 Operator は会話とセッションを共有）。スレッドでは `thread:<threadId>`。分かれた話題は Thread を立てる。いま有効なセッションを 0 または 1 つ持つ（実行ハンドル経由）。定着レビューの対象スコープでもある。
_Avoid_: セッション（Agent 側の語を Discord 側に流用する場合）, 会話鍵に user を載せて人ごと隔離する（場所共有と逆）, Discord セッション

**Operator 鍵**:
Operator 個人を指す鍵（`user:<discordUserId>`）。場所や話題を表さない。人格・USER など、その人に付帯する状態の同一性に使う。会話鍵・セッションとは別。
_Avoid_: sessionKey（会話やセッションと同一視する場合）, 会話鍵の代用

**セッション**:
Cursor Agent 上の対話コンテキスト。`/new` で破棄し、次の発話で新規作成するもの。会話そのものではなく、会話にぶら下がる。配置の MEMORY / Skill、および Operator 付帯の USER 等はセッションをまたいで残る。
_Avoid_: Discord セッション, 会話と同一視したセッション, セッション（修飾なしで Discord 側を指す場合）

**実行ハンドル**:
ある会話のいまのセッションを指す一時参照（`agentId`）。付け替え可能で、コンテナ再作成などで消えうる。セッションの同一性そのものではない。
_Avoid_: セッション（コンテキスト本体と同一視する場合）, 会話

**スレッド**:
入口における Discord の Thread という場所。会話の下位種別ではない。スレッド内の会話鍵は `thread:<threadId>` のみとし、そこに入った許可 Operator は同じ会話／セッションを共有する。
_Avoid_: スレッド会話（種別として立てる場合）, スレッドセッション, スレッド内の user 別鍵

**入口**:
Operator が Discord Agent と話す唯一の操作面。Discord（ギルドの通常チャンネル／DM／スレッド）に限る。
_Avoid_: マルチプラットフォームゲートウェイ, Telegram, Slack, WhatsApp, Hermes gateway（多チャネル）

**MEMORY**:
学習ループが持つ、環境・教訓・作業上の事実のキュレーション済みメモ。
_Avoid_: notes, knowledge base, User Model

**USER**:
学習ループが持つ、Operator 個人の好み・人物像のキュレーション済みプロファイル。Operator 鍵で分かれ、チャンネル／会話を跨いで持ち運ぶ。
_Avoid_: profile, 配置共有の単一 USER（多人運用で個人が混ざる場合）, 会話に紐づくプロファイル

**人格**:
Operator が選ぶ声・口調の設定（`SOUL.md` / personality）。Operator 鍵に紐づき、会話やセッションをまたいでも同じ人なら同じ人格。学習ループの外にあり、エージェントは自動では書き換えない。
_Avoid_: USER（学習対象のプロファイル）, 第4の記憶柱, 会話ごとの人格（個人付帯でない場合）

**Skill**:
学習ループが持つ、再利用可能な手順（`SKILL.md`）。agentskills.io 互換の形を取る。
_Avoid_: prompt template, custom command, plugin

**Operator**:
入口を通じて Discord Agent を操作してよい主体。許可された Discord ユーザーと一致する。同一性は Operator 鍵（`user:<discordUserId>`）。
_Avoid_: 利用者（許可境界をぼかす場合）, Member, Owner（ロール分割が無い現状で）

**配置**:
一つのゲートウェイ稼働単位（一つの `DATA_DIR`）。MEMORY / Skill は配置内で共有。USER・人格は Operator 鍵で分かれ、配置内の別人とは共有しない。作業ディレクトリとは別。
_Avoid_: テナント, Workspace（作業ディレクトリと混同）, 全 Operator で USER を共有

**定期ジョブ**:
スケジュールで発火し、会話履歴に載せず結果をホーム（または指定チャンネル）へ届ける実行。セッション／実行ハンドルは会話と共有しない。
_Avoid_: cron session, 会話の一種, 会話のセッション

**バックグラウンドターン**:
Operator が今の入口から撃つが、進行中の会話を塞がない派生実行。結果は元チャンネルへ戻り、セッション／実行ハンドルは会話本体と別。
_Avoid_: ジョブ（定期ジョブと同一視）, 会話（同一セッションで進める場合）

**書き込み承認**:
学習ループへの MEMORY / USER / Skill の反映を、即時ではなく Operator の approve/reject 待ちにする配置オプション。既定は OFF。
_Avoid_: シェル承認（Cursor に無い能力）, dangerous command approval

**ホーム**:
配置あたり一つの既定 Discord チャンネル。定期ジョブの宛先が無いときの届け先、および起動通知の届け先。会話そのものではない。
_Avoid_: ホーム会話, デフォルトセッション（会話と混同する場合）

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
_Avoid_: 別名会話（タイトルを同一性の核にする場合）, セッション名（セッションの別名にする場合）
