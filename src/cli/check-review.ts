import {
  REVIEW_TEXT_CAP,
  buildDetachedReviewPrompt,
  truncateReviewText,
} from "../agent/review.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main() {
  assert(truncateReviewText("hi") === "hi", "short passthrough");
  assert(truncateReviewText("") === "", "empty passthrough");

  const exact = "x".repeat(REVIEW_TEXT_CAP);
  assert(truncateReviewText(exact) === exact, "exact cap keeps text");

  const over = "x".repeat(REVIEW_TEXT_CAP + 80);
  const cut = truncateReviewText(over);
  assert(cut.endsWith("…(truncated)"), "over cap marked");
  assert(cut.length === REVIEW_TEXT_CAP, "over cap stays at cap including mark");
  assert(!cut.startsWith("…"), "keeps the head, drops the tail");

  const prompt = buildDetachedReviewPrompt("user-hello", "assistant-world");
  assert(prompt.includes("=== LAST USER MESSAGE ==="), "user header");
  assert(prompt.includes("=== LAST ASSISTANT REPLY ==="), "assistant header");
  assert(prompt.includes("user-hello"), "user body");
  assert(prompt.includes("assistant-world"), "assistant body");
  assert(prompt.includes("memory-skills MCP"), "keeps review rules");
  assert(prompt.includes("120 characters"), "keeps Discord one-liner rule");

  const long = buildDetachedReviewPrompt("U".repeat(5000), "A".repeat(5000));
  assert(
    long.split("…(truncated)").length - 1 === 2,
    "both sides truncated",
  );

  console.log("check:review OK");
}

main();
