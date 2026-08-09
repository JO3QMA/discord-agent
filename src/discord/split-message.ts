/** Discord message content hard limit (final string, including wrappers). */
export const DISCORD_CONTENT_MAX = 2000;

type Block =
  | { kind: "text"; text: string }
  | { kind: "fence"; lang: string; body: string }
  | { kind: "table"; header: string[]; rows: string[] };

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(t);
}

function hardCut(s: string, max: number): string[] {
  if (s.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
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
    const line = lines[i]!;
    const fence = /^```(\S*)/.exec(line);
    if (fence) {
      flushText();
      const lang = fence[1] ?? "";
      i += 1;
      const body: string[] = [];
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        body.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ kind: "fence", lang, body: body.join("\n") });
      continue;
    }

    if (line.trimStart().startsWith("|")) {
      flushText();
      const tableLines: string[] = [];
      while (i < lines.length && lines[i]!.trimStart().startsWith("|")) {
        tableLines.push(lines[i]!);
        i += 1;
      }
      let header: string[] = [];
      let rows: string[] = [];
      if (tableLines.length >= 2 && isTableSeparator(tableLines[1]!)) {
        header = [tableLines[0]!, tableLines[1]!];
        rows = tableLines.slice(2);
      } else {
        header = tableLines.length > 0 ? [tableLines[0]!] : [];
        rows = tableLines.slice(1);
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

function splitFence(lang: string, body: string, max: number): string[] {
  const open = "```" + lang + "\n";
  const close = "\n```";
  const wrapped = open + body + close;
  if (wrapped.length <= max) return [wrapped];

  const innerMax = max - open.length - close.length;
  if (innerMax < 1) return hardCut(wrapped, max);

  const lineChunks = packJoined(body.length ? body.split("\n") : [""], innerMax, "\n");
  return lineChunks.map((chunk) => open + chunk + close);
}

function splitTable(header: string[], rows: string[], max: number): string[] {
  const all = [...header, ...rows];
  const full = all.join("\n");
  if (full.length <= max) return [full];

  const headerText = header.join("\n");
  if (header.length === 0 || headerText.length >= max) {
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
    if (headerText.length + 1 + row.length > max) {
      if (buf.length) flush();
      out.push(...hardCut([headerText, row].join("\n"), max));
      continue;
    }
    buf.push(row);
    len += add;
  }
  if (buf.length > 0 || out.length === 0) flush();
  return out;
}

function piecesForBlock(block: Block, max: number): string[] {
  switch (block.kind) {
    case "text":
      return splitText(block.text, max);
    case "fence":
      return splitFence(block.lang, block.body, max);
    case "table":
      return splitTable(block.header, block.rows, max);
  }
}

/**
 * Split long Discord content into messages under `max` (final string length).
 * Prefer paragraph, then line; protect fences/tables; greedy-pack units.
 */
export function splitMessage(
  content: string,
  max: number = DISCORD_CONTENT_MAX,
): string[] {
  if (content.length === 0) return [];
  if (content.length <= max) return [content];
  if (max < 1) return hardCut(content, 1);

  const blocks = parseBlocks(content);
  if (blocks.length === 0) return hardCut(content, max);

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
  return out;
}
