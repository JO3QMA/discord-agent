/**
 * Hermes-style store split. Session preamble and detached review must stay aligned.
 * Living facts go to NOTES.md / references/ via MCP, not into MEMORY/USER dumps.
 */
export const LEARNING_STORE_RULES =
  "Persist with memory-skills MCP only — do not use workspace Read/Write for DATA_DIR/skills (that is not AGENT_CWD). " +
  "Sticky one-liners always needed in context → memory tool (target=memory or user). If at the char limit, replace/remove then retry. Do not squeeze a living list into a memory one-liner. " +
  "How to repeat a task → skill_create / skill_patch on SKILL.md (when to use, steps, pitfalls). SKILL.md may index fact files. " +
  "Ledgers and topic facts (shopping, events, donations, inventory, hardware notes) → that skill's NOTES.md or references/<file>.md. " +
  "Read: skill_view with name plus path=\"NOTES.md\" or path=\"references/foo.md\". Omit path to get SKILL.md and the file list. " +
  "Write: skill_write_file(name, path, content) to create/overwrite NOTES.md or references/*.md. Patch those files with skill_patch(name, old_text, new_text, path). " +
  "Example: shopping items live at skill_view(operator-shopping, path=NOTES.md). memory/user may keep only a pointer like \"買い物: skill_view(operator-shopping, path=NOTES.md)\". " +
  "Past conversation detail → session_search. Never dump ledgers into the SKILL.md body.";

export const MEMORY_TOOL_DESCRIPTION =
  "Curated persistent memory (Hermes-style). Targets: memory (notes) or user (profile). Actions: add|replace|remove|list. Sticky one-liners only. At the char limit, consolidate with replace/remove then retry. Living lists go to skill_write_file (NOTES.md / references/), not here.";

export const SKILL_CREATE_DESCRIPTION =
  "Create a procedural skill (agentskills.io: description ≤60 chars, name [a-z0-9][a-z0-9_-]{0,63}, + body). Body is SKILL.md: when to use, steps, pitfalls, and pointers to NOTES.md / references/*.md. Not for ledgers.";

export const SKILL_PATCH_DESCRIPTION =
  "Surgical replace (old_text must match once). Default path=SKILL.md (procedure only). For ledgers pass path=NOTES.md or path=references/<file>.md. Do not append shopping/events/inventory into SKILL.md.";

export const SKILL_VIEW_DESCRIPTION =
  "Read a skill file. Omit path for SKILL.md plus files[]. Pass path=NOTES.md or path=references/<file>.md for topic facts. Example: skill_view(operator-shopping, path=NOTES.md).";

export const SKILL_WRITE_FILE_DESCRIPTION =
  "Create or overwrite NOTES.md or references/<file>.md under a skill (not SKILL.md). Use this for shopping lists, event logs, inventories. Example: skill_write_file(operator-shopping, path=NOTES.md, content=...).";
