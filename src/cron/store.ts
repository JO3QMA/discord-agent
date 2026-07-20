import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type CronJob = {
  id: string;
  name: string;
  /** cron expr (5-field) or ISO datetime for one-shot */
  schedule: string;
  prompt: string;
  /** Discord channel/thread id for delivery */
  channelId: string;
  paused: boolean;
  noAgent?: boolean;
  /** If noAgent, run as shell via node child — skipped; just deliver prompt text. */
  nextRunAt: string;
  lastRunAt?: string;
  createdAt: string;
};

function cronPath(dataDir: string): string {
  return path.join(dataDir, "cron.json");
}

export async function loadCronJobs(dataDir: string): Promise<CronJob[]> {
  try {
    const raw = await fs.readFile(cronPath(dataDir), "utf8");
    return JSON.parse(raw) as CronJob[];
  } catch {
    return [];
  }
}

async function saveCronJobs(dataDir: string, jobs: CronJob[]): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(cronPath(dataDir), JSON.stringify(jobs, null, 2), "utf8");
}

/** ponytail: tiny 5-field cron matcher; no seconds, no TZ tables beyond process TZ */
export function nextCronAfter(expr: string, from: Date): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length === 1 && !Number.isNaN(Date.parse(parts[0]!))) {
    const t = new Date(parts[0]!);
    return t > from ? t : null;
  }
  if (parts.length !== 5) return null;
  const [minE, hourE, domE, monE, dowE] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const match = (field: string, value: number): boolean => {
    if (field === "*") return true;
    if (field.startsWith("*/")) {
      const n = Number(field.slice(2));
      return Number.isFinite(n) && n > 0 && value % n === 0;
    }
    return field.split(",").some((p) => Number(p) === value);
  };
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (
      match(minE, cursor.getMinutes()) &&
      match(hourE, cursor.getHours()) &&
      match(domE, cursor.getDate()) &&
      match(monE, cursor.getMonth() + 1) &&
      match(dowE, cursor.getDay())
    ) {
      return new Date(cursor);
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

export async function createCronJob(
  dataDir: string,
  input: {
    name: string;
    schedule: string;
    prompt: string;
    channelId: string;
    noAgent?: boolean;
  },
): Promise<CronJob> {
  const jobs = await loadCronJobs(dataDir);
  const now = new Date();
  const next = nextCronAfter(input.schedule, now);
  if (!next) throw new Error(`invalid schedule: ${input.schedule}`);
  const job: CronJob = {
    id: randomUUID().slice(0, 8),
    name: input.name.trim() || "job",
    schedule: input.schedule.trim(),
    prompt: input.prompt,
    channelId: input.channelId,
    paused: false,
    noAgent: input.noAgent,
    nextRunAt: next.toISOString(),
    createdAt: now.toISOString(),
  };
  jobs.push(job);
  await saveCronJobs(dataDir, jobs);
  return job;
}

export async function updateCronJob(
  dataDir: string,
  id: string,
  patch: Partial<CronJob>,
): Promise<CronJob | null> {
  const jobs = await loadCronJobs(dataDir);
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return null;
  const cur = jobs[idx]!;
  const next = { ...cur, ...patch, id: cur.id };
  if (patch.schedule) {
    const n = nextCronAfter(patch.schedule, new Date());
    if (!n) throw new Error(`invalid schedule: ${patch.schedule}`);
    next.nextRunAt = n.toISOString();
  }
  jobs[idx] = next;
  await saveCronJobs(dataDir, jobs);
  return next;
}

export async function removeCronJob(dataDir: string, id: string): Promise<boolean> {
  const jobs = await loadCronJobs(dataDir);
  const next = jobs.filter((j) => j.id !== id);
  if (next.length === jobs.length) return false;
  await saveCronJobs(dataDir, next);
  return true;
}

export type CronDeliver = (channelId: string, text: string) => Promise<void>;
export type CronRunAgent = (prompt: string) => Promise<string>;

export function startCronScheduler(opts: {
  dataDir: string;
  deliver: CronDeliver;
  runAgent: CronRunAgent;
  intervalMs?: number;
}): { stop: () => void } {
  const tick = async () => {
    const jobs = await loadCronJobs(opts.dataDir);
    const now = new Date();
    let changed = false;
    for (const job of jobs) {
      if (job.paused) continue;
      if (new Date(job.nextRunAt) > now) continue;
      try {
        const text = job.noAgent
          ? job.prompt
          : await opts.runAgent(job.prompt);
        await opts.deliver(job.channelId, `⏰ **${job.name}**\n${text}`);
      } catch (err) {
        await opts
          .deliver(
            job.channelId,
            `⏰ **${job.name}** failed: ${err instanceof Error ? err.message : String(err)}`,
          )
          .catch(() => {});
      }
      job.lastRunAt = now.toISOString();
      const next = nextCronAfter(job.schedule, now);
      if (!next) {
        job.paused = true;
      } else {
        job.nextRunAt = next.toISOString();
      }
      changed = true;
    }
    if (changed) await saveCronJobs(opts.dataDir, jobs);
  };

  const handle = setInterval(() => {
    tick().catch((err) => console.error("cron tick:", err));
  }, opts.intervalMs ?? 30_000);
  tick().catch(() => {});
  return { stop: () => clearInterval(handle) };
}
