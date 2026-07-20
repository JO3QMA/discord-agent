import fs from "node:fs/promises";
import path from "node:path";

/** Local Honcho-style user model (no external Honcho dep). */
export type UserModel = {
  traits: string[];
  updatedAt: string;
};

function modelPath(dataDir: string): string {
  return path.join(dataDir, "honcho.json");
}

export async function loadUserModel(dataDir: string): Promise<UserModel> {
  try {
    return JSON.parse(await fs.readFile(modelPath(dataDir), "utf8")) as UserModel;
  } catch {
    return { traits: [], updatedAt: new Date(0).toISOString() };
  }
}

export async function saveUserModel(
  dataDir: string,
  model: UserModel,
): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(modelPath(dataDir), JSON.stringify(model, null, 2), "utf8");
}

export async function addTrait(dataDir: string, trait: string): Promise<UserModel> {
  const text = trait.trim();
  const model = await loadUserModel(dataDir);
  if (!text || model.traits.includes(text)) return model;
  model.traits = [...model.traits, text].slice(-40);
  model.updatedAt = new Date().toISOString();
  await saveUserModel(dataDir, model);
  return model;
}

export async function formatUserModel(dataDir: string): Promise<string> {
  const model = await loadUserModel(dataDir);
  if (!model.traits.length) return "(no user-model traits yet)";
  return model.traits.map((t) => `- ${t}`).join("\n");
}
