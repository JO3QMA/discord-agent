import fs from "node:fs/promises";
import path from "node:path";

/** Which Operator is speaking on the current turn (MCP USER writes). */
function activePath(dataDir: string): string {
  return path.join(dataDir, "runtime", "active-operator");
}

export async function setActiveOperator(
  dataDir: string,
  userId: string,
): Promise<void> {
  const dir = path.dirname(activePath(dataDir));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(activePath(dataDir), userId.trim(), "utf8");
}

export async function getActiveOperator(dataDir: string): Promise<string | null> {
  try {
    const id = (await fs.readFile(activePath(dataDir), "utf8")).trim();
    return id || null;
  } catch {
    return null;
  }
}
