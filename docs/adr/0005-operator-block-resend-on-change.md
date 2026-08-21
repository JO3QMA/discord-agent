# Operator ブロックは変化時のみ再送する

毎ターン再送をやめ、初回・Operator 交代（戻り含む）・内容変化時のみ送る。状態は会話ごとの lastOperatorId + lastOperatorBlockHash の2つで持つ（Operator 別 map は A→B→A の戻りを拾えず、履歴上の「いまの Operator」が B のまま省略されてしまうため不採用）。ハッシュが一致していても isFirst（コンテナ再作成で resume に失敗した resumed=false を含む）は常にフル preamble を送る。
