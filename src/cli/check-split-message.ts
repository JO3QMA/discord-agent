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

  const emoji = "👍".repeat(10);
  const eChunks = splitMessage(emoji, 4);
  assert(eChunks.every((c) => c.length <= 4), "emoji chunks under max");
  assert(eChunks.join("") === emoji, "emoji round-trip");
  assert(
    eChunks.every((c) => c.length % 2 === 0 && /^👍+$/u.test(c)),
    "emoji chunks keep whole code points",
  );

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
  const nt = splitMessage(notTable, DISCORD_CONTENT_MAX);
  assert(nt.length === 1 && nt[0] === notTable, "pipe list is not a table");

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
  assert(sChunks.length >= 2, "spaced lang fence splits");
  for (const c of sChunks) {
    assert(c.startsWith("```ts\n"), "lang tag allows space after fence");
  }

  const nested =
    "````md\n" + "```ts\nconst z = 1;\n```\n" + "outer still open\n" + "````";
  const nChunks = splitMessage(nested);
  assert(nChunks.length === 1, "nested fence stays one block");
  assert(nChunks[0] !== undefined, "nested fence produces a chunk");
  assert(nChunks[0].includes("```ts\n"), "inner fence preserved");
  assert(nChunks[0].includes("outer still open"), "body after inner kept");

  const indentedClose = "```js\nok\n  ```\n\n" + "z".repeat(100);
  const ic = splitMessage(indentedClose, 50);
  assert(
    ic.some((c) => c.includes("```js\n") && c.includes("ok") && c.includes("```")),
    "closing fence allows up to 3 leading spaces",
  );

  const tooIndentedClose = "```js\nok\n    ```\nstill in fence\n```";
  const ti = splitMessage(tooIndentedClose);
  assert(ti[0] !== undefined && ti[0].includes("still in fence"), "4-space line does not close fence");

  const mixed =
    "intro paragraph\n\n```js\nconsole.log(1);\n```\n\n| h |\n| --- |\n| v |\n\noutro";
  const mChunks = splitMessage(mixed, DISCORD_CONTENT_MAX);
  assert(mChunks.length === 1, "mixed under max stays one message");

  const over = "p1\n\n" + "y".repeat(DISCORD_CONTENT_MAX + 10);
  const oChunks = splitMessage(over);
  assert(oChunks.every((c) => c.length <= DISCORD_CONTENT_MAX), "default max 2000");
  assert(oChunks.length >= 2, "default max splits");

  const huge = ("para\n\n").repeat(500) + "z".repeat(5000);
  const capped = splitMessage(huge, 100, 3);
  assert(capped.length === 3, "maxChunks cap");
  assert(capped[2] !== undefined && capped[2].includes("…(truncated)"), "truncation marker");
  assert(capped.every((c) => c.length <= 100), "capped chunks under max");

  assert(DISCORD_MAX_CHUNKS >= 1, "default chunk cap configured");

  // Many modest cells: split on `|`, never mid-cell when a pipe fits in budget.
  const cells = Array.from({ length: 20 }, (_, i) => `c${i}`).join(" | ");
  const wide = `| h1 | h2 |\n| --- | --- |\n| ${cells} |`;
  const wChunks = splitMessage(wide, 80);
  assert(wChunks.every((c) => c.length <= 80), "wide row chunks under max");
  assert(
    wChunks.every((c) => c.includes("| h1 | h2 |")),
    "wide row keeps header",
  );
  assert(
    wChunks.some((c) => c.includes("c0")) && wChunks.some((c) => c.includes("c19")),
    "wide row preserves cell content across chunks",
  );
  assert(
    wChunks.every((c, i) => i === wChunks.length - 1 || c.trimEnd().endsWith("|")),
    "wide row cuts at cell boundaries",
  );

  const oneCol = "| h |\n| --- |\n| v |";
  const oneColChunks = splitMessage(oneCol);
  assert(oneColChunks[0] !== undefined, "single-column table produces a chunk");
  assert(
    oneColChunks[0].includes("| --- |"),
    "single-column table separator recognized",
  );

  const noTrailPipe = "| a | b\n| --- | ---\n| 1 | 2 |";
  const noTrailChunks = splitMessage(noTrailPipe);
  assert(noTrailChunks[0] !== undefined, "no-trailing-pipe table produces a chunk");
  assert(
    noTrailChunks[0].includes("| --- | ---"),
    "separator without trailing pipe recognized",
  );

  const escaped = "| h |\n| --- |\n| a\\|b | " + "x".repeat(40) + " |";
  const escChunks = splitMessage(escaped, 60);
  assert(
    escChunks.every((c, i) => i === escChunks.length - 1 || !c.trimEnd().endsWith("\\|")),
    "does not cut on escaped pipes",
  );
  assert(
    escChunks.every((c) => c.includes("| h |")),
    "escaped-pipe row keeps header",
  );

  // Two backslashes + pipe is a real separator (even escape count).
  const evenEsc =
    "| h |\n| --- |\n| a\\\\\\\\| " + "y".repeat(50) + " | z |";
  const evenChunks = splitMessage(evenEsc, 55);
  assert(evenChunks[0] !== undefined, "even-escape row produces a chunk");
  assert(evenChunks.length >= 2, "even-escape row splits");
  assert(evenChunks[0].trimEnd().endsWith("|"), "even backslashes allow pipe as boundary");

  const indented = "   | h |\n   | --- |\n   | v |";
  const ind = splitMessage(indented);
  assert(ind[0] !== undefined && ind[0] === indented, "3-space indented pipes stay plain text");
  const indChunks = splitMessage(indented + "\n\n" + "z".repeat(100), 40);
  assert(
    indChunks.filter((c) => c.includes("| h |") && c.includes("| --- |")).length === 1,
    "indented pipes do not get table header-repeat split",
  );

  console.log("check-split-message: ok");
}

main();
