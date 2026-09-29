// Reads flashcards from pasted or uploaded text (Anki's "Notes in Plain Text" export, CSV, or TSV) and from Anki
// .apkg packages. Cards are plain text plus MathJax, so HTML is flattened and media is dropped.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import zlib from "node:zlib";
import { unzipSync } from "fflate";

export type CardDraft = { front: string; back: string };
export const MAX_IMPORT_CARDS = 5000;

// Splits delimited text into rows of fields, honoring double-quoted fields that contain delimiters or line breaks.
function parseDelimited(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const separators: Record<string, string> = { tab: "\t", comma: ",", semicolon: ";", pipe: "|", space: " " };

export function parseCardText(text: string): CardDraft[] {
  // Anki's export starts with "#key:value" header lines, such as #separator:tab and #html:true.
  const headers = new Map<string, string>();
  const body = text.replace(/^﻿/, "").replace(/^#([a-z ]+):(.*)(\r?\n|$)/gim, (_, key: string, value: string) => { headers.set(key.trim().toLowerCase(), value.trim()); return ""; });
  const separator = headers.get("separator");
  const firstLine = body.split("\n", 1)[0];
  const delimiter = separator ? separators[separator.toLowerCase()] ?? separator : firstLine.includes("\t") ? "\t" : firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  const html = headers.get("html") === "true" || /<(br|div|p|b|i|span)\b/i.test(body);
  return parseDelimited(body, delimiter)
    .filter((fields) => fields.some((field) => field.trim()))
    .map((fields) => noteToCard(fields, html));
}

// Anki keeps a note's fields separated by \x1f. The first field is the front and the second the back;
// a cloze note becomes one card with the deletions hidden on the front.
function noteToCard(fields: string[], html: boolean): CardDraft {
  const clean = (value = "") => (html ? htmlToText(value) : value).trim();
  const front = clean(fields[0]);
  if (/\{\{c\d+::/.test(front)) {
    return { front: front.replace(/\{\{c\d+::(.*?)(?:::(.*?))?\}\}/g, (_, _answer, hint) => `[${hint || "…"}]`), back: [front.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, "$1"), clean(fields[1])].filter(Boolean).join("\n\n") };
  }
  return { front, back: clean(fields[1]) };
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function htmlToText(html: string) {
  return html
    .replace(/\[sound:[^\]]*\]/g, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => code[0] === "#"
      ? String.fromCodePoint(parseInt(code.slice(code[1].toLowerCase() === "x" ? 2 : 1), code[1].toLowerCase() === "x" ? 16 : 10))
      : entities[code.toLowerCase()] ?? match)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

// Newer Anki exports store a zstd-compressed collection.anki21b and a placeholder collection.anki2, so prefer the newest.
const collections = ["collection.anki21b", "collection.anki21", "collection.anki2"];

export function parseApkg(data: Uint8Array): CardDraft[] {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(data, { filter: (file) => collections.includes(file.name) }); }
  catch { throw new Error("This file is not a readable Anki package"); }
  const name = collections.find((candidate) => files[candidate]);
  if (!name) throw new Error("This Anki package has no notes collection");
  let collection = files[name];
  if (name.endsWith("b")) {
    if (!zlib.zstdDecompressSync) throw new Error("This Anki package needs a newer Node.js to read");
    collection = zlib.zstdDecompressSync(collection);
  }
  // node:sqlite opens files, so the collection is written to a private temporary directory and removed after reading.
  const dir = mkdtempSync(path.join(tmpdir(), "tao-apkg-"));
  try {
    const file = path.join(dir, "collection.sqlite");
    writeFileSync(file, collection);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const rows = db.prepare("SELECT flds FROM notes ORDER BY id").all() as { flds: string }[];
      return rows.map((row) => noteToCard(row.flds.split("\x1f"), true)).filter((card) => card.front);
    } finally { db.close(); }
  } catch (error) {
    throw error instanceof Error && error.message.startsWith("This") ? error : new Error("Could not read the notes in this Anki package");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Trims drafts to the stored limits and drops empty or duplicate fronts.
export function cleanDrafts(drafts: CardDraft[]) {
  const seen = new Set<string>();
  return drafts.flatMap(({ front, back }) => {
    const card = { front: front.trim().slice(0, 4000), back: back.trim().slice(0, 8000) };
    const key = card.front.toLocaleLowerCase();
    if (!card.front || seen.has(key)) return [];
    seen.add(key);
    return [card];
  }).slice(0, MAX_IMPORT_CARDS);
}
