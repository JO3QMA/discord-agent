/**
 * Session store commit must not resurrect a key cleared mid-turn (/new).
 * Conversation key shape matches CONTEXT.md「会話」(channel-shared).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  clearSessionKey,
  commitSessionMeta,
  loadSessionStore,
  saveSessionStore,
} from "../agent/session.js";
import {
  conversationKey,
  operatorKey,
} from "../discord/conversation-key.js";
import { memoryAdd, memoryList, ensureMemoryLayout } from "../memory/store.js";

async function main() {
  const ch = (id: string, thread = false) => ({
    id,
    isThread: () => thread,
  });
  if (conversationKey(ch("c1")) !== "channel:c1") {
    throw new Error("channel key should be place-only");
  }
  if (conversationKey(ch("c1")) !== "channel:c1") {
    throw new Error("same channel shared across operators");
  }
  if (conversationKey(ch("t1", true)) !== "thread:t1") {
    throw new Error("thread key");
  }
  if (operatorKey("u1") !== "user:u1") throw new Error("operator key");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cda-session-"));
  const key = conversationKey(ch("c1"));

  await saveSessionStore(dir, {
    [key]: { agentId: "agent-OLD", turns: 3, lastUserText: "hi" },
  });

  await clearSessionKey(dir, key);
  const saved = await commitSessionMeta(dir, key, "agent-OLD", {
    agentId: "agent-OLD",
    turns: 4,
    lastUserText: "hi",
  });
  if (saved) throw new Error("expected commit to skip after clear");
  if ((await loadSessionStore(dir))[key]) {
    throw new Error("resurrected session after /new");
  }

  await ensureMemoryLayout(dir);
  const a = await memoryAdd(dir, "user", "likes tea", "alice");
  if (!a.success) throw new Error(a.error);
  const b = await memoryAdd(dir, "user", "likes coffee", "bob");
  if (!b.success) throw new Error(b.error);
  const alice = await memoryList(dir, "user", "alice");
  const bob = await memoryList(dir, "user", "bob");
  if (!alice.entries.some((e) => e.includes("tea"))) throw new Error("alice USER");
  if (!bob.entries.some((e) => e.includes("coffee"))) throw new Error("bob USER");
  if (alice.entries.some((e) => e.includes("coffee"))) {
    throw new Error("USER leaked across operators");
  }

  console.log("check:session OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
