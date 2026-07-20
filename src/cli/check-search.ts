import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  indexMessage,
  openSearchDb,
  searchMessages,
} from "../search/fts.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cda-fts-"));
  openSearchDb(dataDir);
  indexMessage(dataDir, "user:1", "user", "typescript strict mode rocks");
  indexMessage(dataDir, "user:1", "assistant", "indeed typescript is great");
  const hits = searchMessages(dataDir, "typescript");
  assert(hits.length >= 1, "expected FTS hit");
  assert(
    hits.some((h) => h.body.includes("typescript")),
    "body should match",
  );
  console.log("check:search OK", hits.length, path.basename(dataDir));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
