/**
 * Hermes-style store split. Session preamble and detached review must stay aligned.
 * Skills are procedures; overflowing MEMORY/USER into SKILL.md is the failure mode.
 */
export const LEARNING_STORE_RULES =
  "Facts and preferences go to memory (shared environment/lessons) or user (this Operator's profile). " +
  "Skills are reusable procedures only (when to use, steps, pitfalls). " +
  "Never put ledgers, shopping lists, event logs, inventories, price snapshots, or memory overflow into SKILL.md — including skill_patch on an existing ledger-like skill. " +
  "When memory/user is full: replace/remove to consolidate in the same turn, then retry; do not spill into skills. Recall details with session_search.";

export const MEMORY_TOOL_DESCRIPTION =
  "Curated persistent memory (Hermes-style). Targets: memory (notes) or user (profile). Actions: add|replace|remove|list. At the char limit, consolidate with replace/remove then retry — do not move overflow into skills.";

export const SKILL_CREATE_DESCRIPTION =
  "Create a procedural skill (agentskills.io: name+description ≤60 chars + body). Body must be a reusable workflow (when to use, steps, pitfalls). Not for ledgers, shopping lists, event logs, inventories, or memory overflow.";

export const SKILL_PATCH_DESCRIPTION =
  "Surgical replace inside an existing SKILL.md (old_text must match once). Patch procedure steps only. Do not append shopping items, event-log rows, inventories, or other factual overflow.";
