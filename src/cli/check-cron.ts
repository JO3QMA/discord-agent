/**
 * Cron scheduler must fire a due job once even if ticks overlap
 * (slow runAgent vs short interval).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createCronJob,
  loadCronJobs,
  nextCronAfter,
  startCronScheduler,
} from "../cron/store.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function markDue(dataDir: string): Promise<void> {
  const jobs = await loadCronJobs(dataDir);
  const first = jobs[0];
  assert(first, "job exists");
  first.nextRunAt = new Date(Date.now() - 1000).toISOString();
  await fs.writeFile(
    path.join(dataDir, "cron.json"),
    JSON.stringify(jobs, null, 2),
    "utf8",
  );
}

async function main() {
  const from = new Date(2026, 7, 26, 10, 0, 0, 0);
  const next = nextCronAfter("* * * * *", from);
  assert(next?.getTime() === new Date(2026, 7, 26, 10, 1, 0, 0).getTime(), "next minute");
  assert(nextCronAfter(from.toISOString(), from) === null, "past one-shot");

  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cda-cron-"));
  await createCronJob(dataDir, {
    name: "due",
    schedule: "* * * * *",
    prompt: "hello",
    channelId: "ch1",
    noAgent: false,
  });
  await markDue(dataDir);

  let delivers = 0;
  const { stop } = startCronScheduler({
    dataDir,
    intervalMs: 40,
    deliver: async () => {
      delivers += 1;
    },
    runAgent: async () => {
      await sleep(120);
      return "ok";
    },
  });
  await sleep(200);
  stop();

  assert(delivers === 1, `due job should fire once, got ${delivers}`);
  console.log("ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
