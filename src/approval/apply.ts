import {
  getPending,
  listPending,
  removePending,
  type PendingWrite,
} from "./pending.js";
import {
  memoryAdd,
  memoryRemove,
  memoryReplace,
} from "../memory/store.js";
import {
  createSkill,
  deleteSkill,
  patchSkill,
} from "../skills/store.js";

export async function applyPending(
  dataDir: string,
  id: string,
): Promise<{ ok: boolean; message: string }> {
  const item = await getPending(dataDir, id);
  if (!item) return { ok: false, message: `pending ${id} not found` };
  try {
    await applyPayload(dataDir, item);
    await removePending(dataDir, id);
    return { ok: true, message: `approved ${id}` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function rejectPending(
  dataDir: string,
  id: string,
): Promise<{ ok: boolean; message: string }> {
  if (id === "all") {
    const all = await listPending(dataDir);
    for (const p of all) await removePending(dataDir, p.id);
    return { ok: true, message: `rejected ${all.length} items` };
  }
  const ok = await removePending(dataDir, id);
  return { ok, message: ok ? `rejected ${id}` : `pending ${id} not found` };
}

export async function approveAll(dataDir: string): Promise<string> {
  const all = await listPending(dataDir);
  let n = 0;
  for (const p of all) {
    const r = await applyPending(dataDir, p.id);
    if (r.ok) n++;
  }
  return `approved ${n}/${all.length}`;
}

async function applyPayload(dataDir: string, item: PendingWrite): Promise<void> {
  const p = item.payload;
  if (item.kind === "memory") {
    const target = p.target as "memory" | "user";
    const operatorId =
      typeof p.operatorId === "string" ? p.operatorId : undefined;
    if (item.action === "add") {
      const r = await memoryAdd(
        dataDir,
        target,
        String(p.content ?? ""),
        operatorId,
      );
      if (!r.success) throw new Error(r.error);
      return;
    }
    if (item.action === "replace") {
      const r = await memoryReplace(
        dataDir,
        target,
        String(p.old_text ?? ""),
        String(p.content ?? ""),
        operatorId,
      );
      if (!r.success) throw new Error(r.error);
      return;
    }
    if (item.action === "remove") {
      const r = await memoryRemove(
        dataDir,
        target,
        String(p.old_text ?? ""),
        operatorId,
      );
      if (!r.success) throw new Error(r.error);
      return;
    }
  }
  if (item.kind === "skill") {
    if (item.action === "create") {
      await createSkill(
        dataDir,
        String(p.name),
        String(p.description),
        String(p.body),
      );
      return;
    }
    if (item.action === "patch") {
      await patchSkill(
        dataDir,
        String(p.name),
        String(p.old_text),
        String(p.new_text),
      );
      return;
    }
    if (item.action === "delete") {
      await deleteSkill(dataDir, String(p.name));
      return;
    }
  }
  throw new Error(`unknown pending action ${item.kind}/${item.action}`);
}
