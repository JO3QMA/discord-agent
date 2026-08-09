/** Discord message content hard limit (final string, including wrappers). */
export const DISCORD_CONTENT_MAX = 2000;

/** Cap split messages to limit rate-limit / channel spam from huge LLM dumps. */
export const DISCORD_MAX_CHUNKS = 20;

type Block =
  | { kind: "text"; text: string }
  | { kind: "fence"; ticks: number; lang: string; body: string }
  | { kind: "table"; header: string[]; rows: string[] };

/** Slice without splitting a UTF-16 surrogate pair. */
function sliceCodeUnitsSafe(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  let end = max;
  const atMax = s.charCodeAt(end);
  if (atMax >= 0xdc00 && atMax <= 0xdfff) end -= 1;
  if (end > 0) {
    const last = s.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  }
  return end > 0 ? s.slice(0, end) : "";
}

function hardCut(s: string, max: number): string[] {
  if (s.length === 0 || max < 1) return s.length === 0 ? [] : [s];
  const out: string[] = [];
  let rest = s;
  while (rest.length > 0) {
    const part = sliceCodeUnitsSafe(rest, max);
    if (!part) break;
    out.push(part);
    rest = rest.slice(part.length);
  }
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
  return /^\|?(\s*:?-+:?\s*\|)*\s*:?-+:?\s*\|?$/.test(t);
}

function isTableLine(line: string): boolean {
  return /^ {0,2}\|/.test(line);
}

function isFenceClose(line: string, openTicks: number): boolean {
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

  return packJoined(body.length ? body.split("\n") : [""], innerMax, "\n").map(
    (chunk) => open + chunk + close,
  );
}

/** Pack rows under header; oversize single rows fall back to hardCut. */
function splitTable(header: string[], rows: string[], max: number): string[] {
  const all = [...header, ...rows];
  const full = all.join("\n");
  if (full.length <= max) return [full];

  const headerText = header.join("\n");
  if (headerText.length >= max) return packJoined(all, max, "\n");

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
    // ponytail: row-only split; cell-boundary cutting deferred
    out.push(...hardCut(headerText + "\n" + row, max));
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
  const notice = "\n…(truncated)";
  const kept = chunks.slice(0, maxChunks - 1);
  const last = chunks[maxChunks - 1] ?? "";
  const room = Math.max(0, max - notice.length);
  return [...kept, sliceCodeUnitsSafe(last, room) + notice];
}

/**
 * Split long Discord content into messages under `max` (final string length).
 * Prefer paragraph, then line; protect fences/tables; greedy-pack units.
 */
export function splitMessage(
  content: string,
  max: number = DISCORD_CONTENT_MAX,
  maxChunks: number = DISCORD_MAX_CHUNKS,
): string[] {
  if (content.length === 0) return [];
  if (content.length <= max) return [content];

  const blocks = parseBlocks(content);
  const pieces =
    blocks.length === 0
      ? hardCut(content, max)
      : blocks.flatMap((b) => piecesForBlock(b, max));

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
