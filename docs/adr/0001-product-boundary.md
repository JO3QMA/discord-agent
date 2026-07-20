# Discord のみの入口と Cursor への実行委譲

Discord Agent は Hermes 互換を目指さない。操作面は Discord のみ。推論・ツール実行は Cursor Agent に委譲し、シェル／ブラウザ／サブエージェント基盤などを自前再実装しない。Hermes 本体プロセス・LiteLLM・CLI/TUI/Dashboard・研究向け trajectory も対象外。学習ループとメッセ UX だけを借りる。
