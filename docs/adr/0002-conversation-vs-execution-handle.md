# 会話と実行ハンドルは別物

会話の同一性は Discord 側の鍵（user/thread）に置く。Cursor の agentId は付け替え可能な実行ハンドルであり、コンテナ再作成で消えうる。sessions.json に残る ID が無いときは新規 create し、会話は継続扱いとする。
