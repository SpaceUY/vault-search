import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseNote, readVault } from "../src/vault-reader.ts";

const FIXTURE_VAULT = fileURLToPath(new URL("./fixtures/vault", import.meta.url));
const IGNORE = ["Images", "Templates"];

function collectWarnings(): { warn: (message: string) => void; messages: string[] } {
  const messages: string[] = [];
  return { warn: (message) => messages.push(message), messages };
}

test("reads every non-ignored note, sorted by path", async () => {
  const { warn } = collectWarnings();
  const docs = await readVault(FIXTURE_VAULT, IGNORE, warn);
  assert.deepEqual(
    docs.map((doc) => doc.path),
    [
      "Alpha/Alpha.md",
      "Alpha/Deploy Guide.md",
      "Alpha/Folded.md",
      "Beta/Broken Frontmatter.md",
      "Beta/Plain Note.md",
      "Beta/Rotating Credentials.md",
      "Home.md",
    ],
  );
});

test("extracts metadata and ignores headings inside code fences", async () => {
  const { warn } = collectWarnings();
  const docs = await readVault(FIXTURE_VAULT, IGNORE, warn);
  const deploy = docs.find((doc) => doc.path === "Alpha/Deploy Guide.md");
  assert.ok(deploy);
  assert.equal(deploy.title, "Deploy Guide");
  assert.equal(deploy.description, "How to roll out a release with zero downtime");
  assert.deepEqual(deploy.tags, ["runbook", "alpha"]);
  assert.equal(deploy.status, "CURRENT");
  assert.deepEqual(deploy.headings, ["Deploy Guide", "Rollback"]);
  assert.match(deploy.hash, /^[0-9a-f]{64}$/);
});

test("a note without frontmatter or heading falls back to the file name", async () => {
  const { warn } = collectWarnings();
  const docs = await readVault(FIXTURE_VAULT, IGNORE, warn);
  const plain = docs.find((doc) => doc.path === "Beta/Plain Note.md");
  assert.ok(plain);
  assert.equal(plain.title, "Plain Note");
  assert.equal(plain.description, "");
  assert.deepEqual(plain.tags, []);
  assert.equal(plain.status, null);
});

test("folded multi-line descriptions collapse to one line", async () => {
  const { warn } = collectWarnings();
  const docs = await readVault(FIXTURE_VAULT, IGNORE, warn);
  assert.equal(docs.find((doc) => doc.path === "Alpha/Folded.md")?.description, "multi line text");
});

test("malformed frontmatter warns once and keeps the body", async () => {
  const { warn, messages } = collectWarnings();
  const docs = await readVault(FIXTURE_VAULT, IGNORE, warn);
  const broken = docs.find((doc) => doc.path === "Beta/Broken Frontmatter.md");
  assert.ok(broken);
  assert.equal(broken.title, "Broken");
  assert.equal(broken.description, "");
  assert.match(broken.body, /quokka/);
  assert.equal(messages.length, 1);
  assert.match(messages[0] ?? "", /Beta\/Broken Frontmatter\.md/);
});

test("non-mapping, empty and CRLF frontmatter all produce a normal Doc", () => {
  const { warn, messages } = collectWarnings();
  const list = parseNote("a.md", "---\n- one\n- two\n---\n# A\n", warn);
  assert.equal(list.title, "A");
  assert.equal(list.description, "");
  const empty = parseNote("b.md", "---\n---\n# B\n", warn);
  assert.equal(empty.title, "B");
  const crlf = parseNote(
    "c.md",
    "---\r\ndescription: windows note\r\ntags: [x]\r\n---\r\n# C\r\n\r\nbody\r\n",
    warn,
  );
  assert.equal(crlf.description, "windows note");
  assert.deepEqual(crlf.tags, ["x"]);
  assert.equal(crlf.title, "C");
  assert.deepEqual(messages, []);
});

test("tags may be a comma or space separated string, with leading hashes stripped", () => {
  const doc = parseNote("t.md", "---\ntags: '#alpha, beta gamma'\n---\n", () => undefined);
  assert.deepEqual(doc.tags, ["alpha", "beta", "gamma"]);
});

test("empty frontmatter keeps the title and body even when a later --- rule follows", () => {
  const doc = parseNote("e.md", "---\n---\n# Title\n\ntext\n\n---\n\nmore\n", () => undefined);
  assert.equal(doc.title, "Title");
  assert.deepEqual(doc.headings, ["Title"]);
  assert.match(doc.body, /text/);
  assert.match(doc.body, /more/);
});

test("duplicate frontmatter keys keep the note's metadata and do not warn", () => {
  const { warn, messages } = collectWarnings();
  const doc = parseNote(
    "d.md",
    "---\ndescription: kept\ntags: [a]\ncreated: 1\ncreated: 2\n---\n# D\n",
    warn,
  );
  assert.equal(doc.description, "kept");
  assert.deepEqual(doc.tags, ["a"]);
  assert.deepEqual(messages, []);
});

test("dot-directories and dot-files are never read", async () => {
  const { warn } = collectWarnings();
  const docs = await readVault(FIXTURE_VAULT, IGNORE, warn);
  assert.deepEqual(
    docs.filter((doc) => doc.path.split("/").some((part) => part.startsWith("."))),
    [],
  );
});

test("a heading ending in # keeps it unless it is a closing sequence", () => {
  const doc = parseNote("h.md", "# Learning C#\n\n## Closed ##\n", () => undefined);
  assert.deepEqual(doc.headings, ["Learning C#", "Closed"]);
});
