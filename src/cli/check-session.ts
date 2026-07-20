/**
 * Session store commit must not resurrect a key cleared mid-turn (/new).
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

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cda-session-"));

  await saveSessionStore(dir, {
    "user:1": { agentId: "agent-OLD", turns: 3, lastUserText: "hi" },
  });

  // Simulate /new while a turn still holds openedAgentId=agent-OLD
  await clearSessionKey(dir, "user:1");
  const saved = await commitSessionMeta(dir, "user:1", "agent-OLD", {
    agentId: "agent-OLD",
    turns: 4,
    lastUserText: "hi",
  });
  if (saved) throw new Error("expected commit to skip after clear");
  const after = await loadSessionStore(dir);
  if (after["user:1"]) throw new Error("resurrected session after /new");

  // Fresh create (no prior mapping) must still commit
  const ok = await commitSessionMeta(dir, "user:1", undefined, {
    agentId: "agent-NEW",
    turns: 1,
  });
  if (!ok) throw new Error("expected fresh create to commit");
  if ((await loadSessionStore(dir))["user:1"]?.agentId !== "agent-NEW") {
    throw new Error("fresh create missing");
  }

  // Stale-id → create replacement must commit
  await saveSessionStore(dir, {
    "user:1": { agentId: "agent-STALE", turns: 2 },
  });
  const replaced = await commitSessionMeta(dir, "user:1", "agent-STALE", {
    agentId: "agent-FRESH",
    turns: 3,
  });
  if (!replaced) throw new Error("expected stale→fresh commit");
  if ((await loadSessionStore(dir))["user:1"]?.agentId !== "agent-FRESH") {
    throw new Error("stale replacement failed");
  }

  console.log("check:session OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
