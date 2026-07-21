import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type PendingKind = "memory" | "skill";

export type PendingWrite = {
  id: string;
  kind: PendingKind;
  action: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
  auto?: boolean;
};

function pendingDir(dataDir: string): string {
  return path.join(dataDir, "pending");
}

function pendingFile(dataDir: string, id: string): string {
  return path.join(pendingDir(dataDir), `${id}.json`);
}

export async function ensurePendingLayout(dataDir: string): Promise<void> {
  await fs.mkdir(pendingDir(dataDir), { recursive: true });
}

export async function listPending(dataDir: string): Promise<PendingWrite[]> {
  await ensurePendingLayout(dataDir);
  const names = await fs.readdir(pendingDir(dataDir));
  const out: PendingWrite[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(pendingDir(dataDir), name), "utf8");
      out.push(JSON.parse(raw) as PendingWrite);
    } catch {
      // skip
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function stageWrite(
  dataDir: string,
  kind: PendingKind,
  action: string,
  summary: string,
  payload: Record<string, unknown>,
  auto = false,
): Promise<PendingWrite> {
  await ensurePendingLayout(dataDir);
  const item: PendingWrite = {
    id: randomUUID().slice(0, 8),
    kind,
    action,
    summary: summary.slice(0, 200),
    payload,
    createdAt: new Date().toISOString(),
    auto,
  };
  await fs.writeFile(pendingFile(dataDir, item.id), JSON.stringify(item, null, 2));
  return item;
}

export async function getPending(
  dataDir: string,
  id: string,
): Promise<PendingWrite | null> {
  try {
    const raw = await fs.readFile(pendingFile(dataDir, id), "utf8");
    return JSON.parse(raw) as PendingWrite;
  } catch {
    return null;
  }
}

export async function removePending(dataDir: string, id: string): Promise<boolean> {
  try {
    await fs.unlink(pendingFile(dataDir, id));
    return true;
  } catch {
    return false;
  }
}
