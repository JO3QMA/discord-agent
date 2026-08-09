import {
  DISCORD_CONTENT_MAX,
  DISCORD_MAX_CHUNKS,
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
  const tChunks = splitMessage(table, 40);
  assert(tChunks.every((c) => c.length <= 40), "table chunks under max");
  assert(tChunks.length >= 2, "table splits when oversized");
  for (const c of tChunks) {
    assert(c.includes("| a | b |"), "table header repeated");
    assert(c.includes("| --- | --- |"), "table separator repeated");
  }

  const notTable = "| not a table\njust text";
  assert(splitMessage(notTable)[0] === notTable, "pipe list is not a table");

  const fence = "```ts\n" + "const a = 1;\n".repeat(30) + "```";
  const fChunks = splitMessage(fence, 80);
  assert(fChunks.every((c) => c.length <= 80), "fence chunks under max");
  assert(fChunks.length >= 2, "fence splits when oversized");
  for (const c of fChunks) {
    assert(c.startsWith("```ts\n"), "fence reopened with lang");
    assert(c.endsWith("\n```"), "fence closed each chunk");
  }

  const spaced = "``` ts\n" + "const x = 1;\n".repeat(40) + "```";
  const sChunks = splitMessage(spaced, 80);
  assert(sChunks.every((c) => c.startsWith("```ts\n")), "lang tag allows space");

  const nested =
    "````md\n" + "```ts\nconst z = 1;\n```\n" + "outer still open\n" + "````";
  const nChunks = splitMessage(nested);
  assert(nChunks.length === 1, "nested fence stays one block");
  assert(nChunks[0] !== undefined && nChunks[0].includes("outer still open"), "inner fence preserved");

  const mixed =
    "intro\n\n```js\nconsole.log(1);\n```\n\n| h |\n| --- |\n| v |\n\noutro";
  assert(splitMessage(mixed, DISCORD_CONTENT_MAX).length === 1, "mixed under max");

  const over = "p1\n\n" + "y".repeat(DISCORD_CONTENT_MAX + 10);
  const oChunks = splitMessage(over);
  assert(oChunks.every((c) => c.length <= DISCORD_CONTENT_MAX), "default max 2000");
  assert(oChunks.length >= 2, "default max splits");

  const huge = ("para\n\n").repeat(500) + "z".repeat(5000);
  const capped = splitMessage(huge, 100, 3);
  assert(capped.length === 3, "maxChunks cap");
  assert(capped[2] !== undefined && capped[2].includes("…(truncated)"), "truncation marker");
  assert(DISCORD_MAX_CHUNKS >= 1, "default chunk cap configured");

  console.log("check-split-message: ok");
}

main();
