/** Discord message content hard limit (final string, including wrappers). */
export const DISCORD_CONTENT_MAX = 2000;

/** Cap split messages to limit rate-limit / channel spam from huge LLM dumps. */
export const DISCORD_MAX_CHUNKS = 20;

type Block =
  | { kind: "text"; text: string }
  | { kind: "fence"; ticks: number; lang: string; body: string }
  | { kind: "table"; header: string[]; rows: string[] };

const graphemeSeg =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function graphemes(s: string): string[] {
  if (graphemeSeg) {
    return Array.from(graphemeSeg.segment(s), (x) => x.segment);
  }
  return Array.from(s);
}

/** Slice without splitting a trailing UTF-16 surrogate pair. */
function sliceCodeUnitsSafe(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  for (let i = max; i > 0; i--) {
    const code = s.charCodeAt(i - 1);
    if (code < 0xdc00 || code > 0xdfff) return s.slice(0, i);
  }
  return s.slice(0, max);
}

/** Take a prefix with JS/Discord length <= max, without splitting graphemes when possible. */
function takeLen(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = "";
  for (const g of graphemes(s)) {
    if (out.length + g.length > max) break;
    out += g;
  }
  return out.length > 0 ? out : sliceCodeUnitsSafe(s, max);
}

function hardCut(s: string, max: number): string[] {
  if (s.length === 0) return [];
  if (max < 1) return [s];
  const out: string[] = [];
  let buf = "";
  for (const g of graphemes(s)) {
    if (buf.length + g.length > max) {
      if (buf) out.push(buf);
      if (g.length > max) {
        let rest = g;
        while (rest.length > 0) {
          const part = sliceCodeUnitsSafe(rest, max);
          if (!part) break;
          out.push(part);
          rest = rest.slice(part.length);
        }
        buf = "";
      } else {
        buf = g;
      }
    } else {
      buf += g;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function packJoined(parts: string[], max: number, join: string): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let len = 0;
  for (const part of parts) {
    if (part.length > max) {
      if (buf.length) {
        out.push(buf.join(join));
        buf = [];
        len = 0;
      }
      out.push(...hardCut(part, max));
      continue;
    }
    const add = buf.length === 0 ? part.length : join.length + part.length;
    if (buf.length && len + add > max) {
      out.push(buf.join(join));
      buf = [part];
      len = part.length;
    } else {
      buf.push(part);
      len += add;
    }
  }
  if (buf.length) out.push(buf.join(join));
  return out;
}

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  // GFM separator: one+ dash cells; leading/trailing pipes optional (incl. |---| and | --- | ---).
  return /^\|?(\s*:?-+:?\s*\|)*\s*:?-+:?\s*\|?$/.test(t);
}

/** GFM: 3+ leading spaces → indented code, not a table row. */
function isTableLine(line: string): boolean {
  return /^ {0,2}\|/.test(line);
}

function isFenceClose(line: string, openTicks: number): boolean {
  // CommonMark: closing fence may be indented up to 3 spaces (same as open).
  const m = /^( {0,3})(```+)(?:\s*)$/.exec(line);
  return !!m && m[2]!.length >= openTicks;
}

function parseBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  let textLines: string[] = [];

  const flushText = () => {
    if (textLines.length === 0) return;
    const raw = textLines.join("\n");
    textLines = [];
    for (const para of raw.split(/\n\n+/)) {
      if (para.length > 0) blocks.push({ kind: "text", text: para });
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    // CommonMark: opening fence may be indented up to 3 spaces.
    const fence = /^( {0,3})(```+)\s*(\S*)/.exec(line);
    if (fence) {
      flushText();
      const ticks = fence[2]!.length;
      const lang = fence[3] ?? "";
      i += 1;
      const body: string[] = [];
      while (i < lines.length) {
        const closeLine = lines[i];
        if (closeLine === undefined || isFenceClose(closeLine, ticks)) break;
        body.push(closeLine);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ kind: "fence", ticks, lang, body: body.join("\n") });
      continue;
    }

    // GFM table: header row + separator required (avoid treating "| foo" lists as tables).
    if (
      isTableLine(line) &&
      i + 1 < lines.length &&
      isTableLine(lines[i + 1]!) &&
      isTableSeparator(lines[i + 1]!)
    ) {
      flushText();
      const header = [line, lines[i + 1]!];
      i += 2;
      const rows: string[] = [];
      while (i < lines.length) {
        const row = lines[i];
        if (row === undefined || !isTableLine(row)) break;
        rows.push(row);
        i += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    textLines.push(line);
    i += 1;
  }
  flushText();
  return blocks;
}

function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  return packJoined(text.split("\n"), max, "\n");
}

function splitFence(
  ticks: number,
  lang: string,
  body: string,
  max: number,
): string[] {
  const mark = "`".repeat(ticks);
  const open = mark + lang + "\n";
  const close = "\n" + mark;
  const wrapped = open + body + close;
  if (wrapped.length <= max) return [wrapped];

  const innerMax = max - open.length - close.length;
  if (innerMax < 1) return hardCut(wrapped, max);

  const lineChunks = packJoined(
    body.length ? body.split("\n") : [""],
    innerMax,
    "\n",
  );
  return lineChunks.map((chunk) => open + chunk + close);
}

/** Prefer cutting an oversize table row at the last unescaped `|` within budget. */
function truncateRowAtCell(row: string, budget: number): {
  kept: string;
  rest: string;
} {
  if (row.length <= budget) return { kept: row, rest: "" };
  const slice = takeLen(row, budget);
  let cut = slice.length;
  while ((cut = slice.lastIndexOf("|", cut - 1)) >= 0) {
    let escapes = 0;
    for (let i = cut - 1; i >= 0 && slice[i] === "\\"; i--) escapes += 1;
    if (escapes % 2 === 1) continue;
    return { kept: slice.slice(0, cut + 1), rest: row.slice(cut + 1) };
  }
  return { kept: slice, rest: row.slice(slice.length) };
}

function splitTable(header: string[], rows: string[], max: number): string[] {
  const all = [...header, ...rows];
  const full = all.join("\n");
  if (full.length <= max) return [full];

  const headerText = header.join("\n");
  if (headerText.length >= max) {
    return packJoined(all, max, "\n");
  }

  const out: string[] = [];
  let buf: string[] = [];
  let len = headerText.length;

  const flush = () => {
    out.push([...header, ...buf].join("\n"));
    buf = [];
    len = headerText.length;
  };

  for (const row of rows) {
    const add = 1 + row.length;
    if (buf.length > 0 && len + add > max) flush();
    if (headerText.length + 1 + row.length <= max) {
      buf.push(row);
      len += add;
      continue;
    }
    if (buf.length) flush();
    let remaining = row;
    while (remaining.length > 0) {
      const budget = max - headerText.length - 1;
      if (budget < 1) {
        out.push(...hardCut(remaining, max));
        break;
      }
      if (remaining.length <= budget) {
        out.push(headerText + "\n" + remaining);
        break;
      }
      const { kept, rest } = truncateRowAtCell(remaining, budget);
      if (!kept) {
        out.push(...hardCut(remaining, max));
        break;
      }
      out.push(headerText + "\n" + kept);
      remaining = rest;
    }
  }
  if (buf.length > 0 || out.length === 0) flush();
  return out;
}

function piecesForBlock(block: Block, max: number): string[] {
  switch (block.kind) {
    case "text":
      return splitText(block.text, max);
    case "fence":
      return splitFence(block.ticks, block.lang, block.body, max);
    case "table":
      return splitTable(block.header, block.rows, max);
  }
}

function applyChunkCap(
  chunks: string[],
  max: number,
  maxChunks: number,
): string[] {
  if (maxChunks < 1) maxChunks = 1;
  if (chunks.length <= maxChunks) return chunks;
  const kept = chunks.slice(0, maxChunks);
  const notice = "\n…(truncated)";
  const last = kept[maxChunks - 1]!;
  const room = max - notice.length;
  kept[maxChunks - 1] =
    room < 1 ? takeLen(notice.trimStart(), max) : takeLen(last, room) + notice;
  return kept;
}

/**
 * Split long Discord content into messages under `max` (final string length).
 * Prefer paragraph, then line; protect fences/tables; greedy-pack units.
 * Caps at `maxChunks` (truncates remainder) to avoid spam / rate limits.
 */
export function splitMessage(
  content: string,
  max: number = DISCORD_CONTENT_MAX,
  maxChunks: number = DISCORD_MAX_CHUNKS,
): string[] {
  if (content.length === 0) return [];
  if (max < 1) return applyChunkCap(hardCut(content, 1), 1, maxChunks);
  if (content.length <= max) return [content];

  const blocks = parseBlocks(content);
  if (blocks.length === 0) {
    return applyChunkCap(hardCut(content, max), max, maxChunks);
  }

  const pieces: string[] = [];
  for (const block of blocks) pieces.push(...piecesForBlock(block, max));

  const out: string[] = [];
  let cur = "";
  for (const piece of pieces) {
    if (!piece) continue;
    if (!cur) {
      cur = piece;
      continue;
    }
    const sep = "\n\n";
    if (cur.length + sep.length + piece.length <= max) {
      cur = cur + sep + piece;
    } else {
      out.push(cur);
      cur = piece;
    }
  }
  if (cur) out.push(cur);
  return applyChunkCap(out, max, maxChunks);
}
