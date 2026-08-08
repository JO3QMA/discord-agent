import type { Message } from "discord.js";
import { pathToFileURL } from "node:url";

/** CONTEXT.md「ターン状態リアクション」 */
export const TURN_REACT = {
  start: "👀",
  ok: "☑",
  fail: "❌",
} as const;

/** CONTEXT.md「キュー待ちリアクション」 — Discord `:infinity:` */
export const QUEUE_REACT = "♾️";

export type QueueReactPlan = {
  waiting: boolean;
  remove?: string;
  add?: string;
};

/** Discord を触らない状態遷移。テスト用にも使う。 */
export function planQueueReaction(
  waiting: boolean,
  event: "wait" | "start" | "discard",
): QueueReactPlan {
  if (event === "wait") {
    if (waiting) return { waiting };
    return { waiting: true, add: QUEUE_REACT };
  }
  if (event === "start") {
    if (!waiting) return { waiting: false };
    return { waiting: false, remove: QUEUE_REACT };
  }
  if (event === "discard") {
    if (!waiting) return { waiting: false, add: TURN_REACT.fail };
    return { waiting: false, remove: QUEUE_REACT, add: TURN_REACT.fail };
  }
  // Exhaustiveness guard for future event additions.
  const _never: never = event;
  return _never;
}

async function removeBotEmoji(
  message: Message,
  emoji: string,
): Promise<boolean> {
  const botId = message.client.user?.id;
  if (!botId) return false;
  // Discord may normalize away U+FE0F; try both forms.
  const reaction =
    message.reactions.resolve(emoji) ??
    (emoji.includes("\uFE0F")
      ? message.reactions.resolve(emoji.replaceAll("\uFE0F", ""))
      : message.reactions.resolve(`${emoji}\uFE0F`));
  if (!reaction) return false;
  await reaction.users.remove(botId);
  return true;
}

export async function markQueueWaiting(
  message: Message | undefined,
): Promise<boolean> {
  if (!message) return true;
  try {
    await message.react(QUEUE_REACT);
    return true;
  } catch (err) {
    console.error("queue reaction wait:", err);
    return false;
  }
}

export async function clearQueueWaiting(
  message: Message | undefined,
): Promise<boolean> {
  if (!message) return true;
  try {
    return await removeBotEmoji(message, QUEUE_REACT);
  } catch (err) {
    console.error("queue reaction clear:", err);
    return false;
  }
}

export async function discardQueueWaiting(
  message: Message | undefined,
): Promise<boolean> {
  if (!message) return true;
  // Add ❌ first so discard is visible even if ♾️ removal fails.
  // If add fails, leave ♾️ so the message is not left with no mark.
  // Do not remove-first: that can leave the message with no mark at all.
  try {
    await message.react(TURN_REACT.fail);
  } catch (err) {
    console.error("queue reaction discard add:", err);
    return false;
  }
  try {
    let removed = await removeBotEmoji(message, QUEUE_REACT);
    if (!removed) {
      await new Promise((r) => setTimeout(r, 250));
      removed = await removeBotEmoji(message, QUEUE_REACT);
    }
    if (!removed) {
      console.error(
        "queue reaction discard remove: ♾️ still present after retry; ❌ kept",
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("queue reaction discard remove:", err);
    return false;
  }
}

export type TurnReactPhase = "none" | "started" | "terminal";

export type TurnReactPlan = {
  phase: TurnReactPhase;
  remove?: string;
  add?: string;
};

/** Discord を触らない状態遷移。テスト用にも使う。 */
export function planTurnReaction(
  phase: TurnReactPhase,
  event: "start" | "ok" | "fail",
): TurnReactPlan {
  if (event === "start") {
    if (phase !== "none") return { phase };
    return { phase: "started", add: TURN_REACT.start };
  }
  if (phase === "terminal") return { phase };
  const add = event === "ok" ? TURN_REACT.ok : TURN_REACT.fail;
  if (phase === "started") {
    return { phase: "terminal", remove: TURN_REACT.start, add };
  }
  return { phase: "terminal", add };
}

export type TurnReactionHandle = {
  started: () => Promise<void>;
  succeeded: () => Promise<void>;
  failed: () => Promise<void>;
};

export function turnReactions(message: Message | undefined): TurnReactionHandle {
  if (!message) {
    return {
      started: async () => {},
      succeeded: async () => {},
      failed: async () => {},
    };
  }

  let phase: TurnReactPhase = "none";

  const apply = async (event: "start" | "ok" | "fail"): Promise<void> => {
    const plan = planTurnReaction(phase, event);
    if (!plan.add && !plan.remove) return;
    try {
      if (plan.remove) await removeBotEmoji(message, plan.remove);
      if (plan.add) await message.react(plan.add);
      phase = plan.phase;
    } catch (err) {
      console.error(`turn reaction ${event}:`, err);
    }
  };

  return {
    started: () => apply("start"),
    succeeded: () => apply("ok"),
    failed: () => apply("fail"),
  };
}

export function selfCheckTurnReactions(): void {
  const eq = (
    a: TurnReactPlan | QueueReactPlan,
    b: TurnReactPlan | QueueReactPlan,
    msg: string,
  ) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    }
  };
  eq(planTurnReaction("none", "start"), { phase: "started", add: "👀" }, "start");
  eq(
    planTurnReaction("started", "ok"),
    { phase: "terminal", remove: "👀", add: "☑" },
    "ok",
  );
  eq(
    planTurnReaction("started", "fail"),
    { phase: "terminal", remove: "👀", add: "❌" },
    "fail",
  );
  eq(planTurnReaction("terminal", "ok"), { phase: "terminal" }, "idempotent ok");
  eq(planTurnReaction("none", "fail"), { phase: "terminal", add: "❌" }, "fail without start");
  eq(planTurnReaction("started", "start"), { phase: "started" }, "no double start");

  eq(planQueueReaction(false, "wait"), { waiting: true, add: "♾️" }, "queue wait");
  eq(planQueueReaction(true, "wait"), { waiting: true }, "queue wait idempotent");
  eq(
    planQueueReaction(true, "start"),
    { waiting: false, remove: "♾️" },
    "queue start clears",
  );
  eq(
    planQueueReaction(true, "discard"),
    { waiting: false, remove: "♾️", add: "❌" },
    "queue discard",
  );
  eq(
    planQueueReaction(false, "discard"),
    { waiting: false, add: "❌" },
    "queue discard without waiting",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  selfCheckTurnReactions();
  console.log("turn-reactions self-check ok");
}
