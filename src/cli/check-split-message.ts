import {
  DISCORD_CONTENT_MAX,
  splitMessage,
} from "../discord/split-message.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main() {
  assert(splitMessage("").length === 0, "empty → no chunks");
  assert(splitMessage("hi").join("|") === "hi", "short passthrough");

  const paras = "aaa\n\nbbb\n\nccc";
  const pChunks = splitMessage(paras, 7);
  assert(pChunks.every((c) => c.length <= 7), "paragraph chunks under max");
  assert(pChunks.join("\n\n") === paras, "paragraph round-trip via blank lines");
  assert(!pChunks.some((c) => c.includes("aaa\n\nbbb") && c.length > 7), "no oversize merge");

  const longLine = "x".repeat(50);
  const hard = splitMessage(longLine, 20);
  assert(hard.length === 3, "hard-cut long line");
  assert(hard.every((c) => c.length <= 20), "hard-cut sizes");
  assert(hard.join("") === longLine, "hard-cut preserves bytes");

  const table = [
    "| a | b |",
    "| --- | --- |",
    "| 1 | 2 |",
    "| 3 | 4 |",
    "| 5 | 6 |",
  ].join("\n");
  // header+sep = 2 lines; force split so each data row needs own message-ish
  const tChunks = splitMessage(table, 40);
  assert(tChunks.every((c) => c.length <= 40), "table chunks under max");
  assert(tChunks.length >= 2, "table splits when oversized");
  for (const c of tChunks) {
    assert(c.includes("| a | b |"), "table header repeated");
    assert(c.includes("| --- | --- |"), "table separator repeated");
  }

  const fence = "```ts\n" + "const a = 1;\n".repeat(30) + "```";
  const fChunks = splitMessage(fence, 80);
  assert(fChunks.every((c) => c.length <= 80), "fence chunks under max");
  assert(fChunks.length >= 2, "fence splits when oversized");
  for (const c of fChunks) {
    assert(c.startsWith("```ts\n"), "fence reopened with lang");
    assert(c.endsWith("\n```"), "fence closed each chunk");
  }

  const mixed =
    "intro paragraph\n\n```js\nconsole.log(1);\n```\n\n| h |\n| --- |\n| v |\n\noutro";
  const mChunks = splitMessage(mixed, DISCORD_CONTENT_MAX);
  assert(mChunks.length === 1, "mixed under max stays one message");
  assert(mChunks[0]!.includes("```js\n"), "fence preserved in mixed");

  const over = "p1\n\n" + "y".repeat(DISCORD_CONTENT_MAX + 10);
  const oChunks = splitMessage(over);
  assert(oChunks.every((c) => c.length <= DISCORD_CONTENT_MAX), "default max 2000");
  assert(oChunks.length >= 2, "default max splits");

  console.log("check-split-message: ok");
}

main();
