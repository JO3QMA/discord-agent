import type { Message } from "discord.js";
import { pathToFileURL } from "node:url";

/** CONTEXT.md「ターン状態リアクション」 */
export const TURN_REACT = {
  start: "👀",
  ok: "☑",
  fail: "❌",
} as const;

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
      if (plan.remove) {
        const botId = message.client.user?.id;
        if (botId) {
          await message.reactions.resolve(plan.remove)?.users.remove(botId);
        }
      }
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
  const eq = (a: TurnReactPlan, b: TurnReactPlan, msg: string) => {
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  selfCheckTurnReactions();
  console.log("turn-reactions self-check ok");
}
