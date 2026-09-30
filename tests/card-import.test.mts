import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { zipSync } from "fflate";
import { cleanDrafts, htmlToText, parseApkg, parseCardText } from "../lib/card-import.ts";

test("Anki plain text exports use their header separator and HTML setting", () => {
  const cards = parseCardText("#separator:tab\n#html:true\nWhat is \\(e^{i\\pi}\\)?\t\\(-1\\)<br>by Euler\n");
  assert.deepEqual(cards, [{ front: "What is \\(e^{i\\pi}\\)?", back: "\\(-1\\)\nby Euler" }]);
});

test("CSV keeps quoted commas and line breaks inside a field", () => {
  const cards = parseCardText('"Define a group, briefly","A set with\nan operation"\nRing,Two operations\n');
  assert.deepEqual(cards, [
    { front: "Define a group, briefly", back: "A set with\nan operation" },
    { front: "Ring", back: "Two operations" },
  ]);
});

test("cloze notes hide deletions on the front and show them on the back", () => {
  const [card] = parseCardText("{{c1::Paris::city}} is the capital of {{c2::France}}\t");
  assert.equal(card.front, "[city] is the capital of […]");
  assert.equal(card.back, "Paris is the capital of France");
});

test("HTML entities and tags are flattened to text", () => {
  assert.equal(htmlToText("<div>a &lt; b&nbsp;&amp;&#39;c&#x27;</div>[sound:x.mp3]"), "a < b &'c'\n");
});

test("duplicate and empty fronts are dropped", () => {
  assert.deepEqual(cleanDrafts([{ front: " A ", back: "1" }, { front: "a", back: "2" }, { front: "", back: "3" }]), [{ front: "A", back: "1" }]);
});

test("an .apkg package yields its notes' first two fields", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tao-test-"));
  try {
    const file = path.join(dir, "c.sqlite");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE notes (id integer primary key, flds text)");
    db.prepare("INSERT INTO notes VALUES (?, ?)").run(1, "Front <b>one</b>\x1fBack one\x1fextra");
    db.prepare("INSERT INTO notes VALUES (?, ?)").run(2, "Front two\x1fBack<br>two");
    db.close();
    const apkg = zipSync({ "collection.anki21": readFileSync(file), media: new TextEncoder().encode("{}") });
    assert.deepEqual(parseApkg(apkg), [{ front: "Front one", back: "Back one" }, { front: "Front two", back: "Back\ntwo" }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a file that is not a zip is rejected with a readable message", () => {
  assert.throws(() => parseApkg(new TextEncoder().encode("not a zip")), /not a readable Anki package/);
});
