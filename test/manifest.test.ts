import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  manifestStrategy,
  parseManifestEntries,
  renderManifestBody,
} from "../src/strategies/manifest.ts";
import type { Ctx } from "../src/types.ts";
import { makeDoc } from "./helpers.ts";

const DASH = "—";

const DOCS = [
  makeDoc({ path: "Beta/Zed.md", title: "Zed", description: "Last one" }),
  makeDoc({ path: "Home.md", title: "Home", description: "Entry point" }),
  makeDoc({ path: "Alpha/Alpha.md", title: "Alpha", description: "Alpha index" }),
  makeDoc({ path: "Alpha/Bare.md", title: "Bare" }),
];

async function makeCtx(): Promise<Ctx> {
  const dir = await mkdtemp(path.join(tmpdir(), "search-manifest-"));
  return { vaultRoot: dir, indexDir: path.join(dir, ".index") };
}

test("groups by top-level folder with Root first, entries sorted by path", () => {
  const body = renderManifestBody(DOCS);
  const sections = [
    "## Root",
    `- [[Home|Home]] ${DASH} Entry point`,
    "",
    "## Alpha",
    `- [[Alpha/Alpha|Alpha]] ${DASH} Alpha index`,
    "- [[Alpha/Bare|Bare]]",
    "",
    "## Beta",
    `- [[Beta/Zed|Zed]] ${DASH} Last one`,
    "",
  ].join("\n");
  assert.ok(body.includes(sections), body);
});

test("parseManifestEntries reads back what the manifest renders, including pipes in titles", () => {
  const docs = [
    ...DOCS,
    makeDoc({ path: "Seismic/Pipe.md", title: "Seismic | Identity", description: "Has | pipes" }),
  ];
  const entries = parseManifestEntries(renderManifestBody(docs));
  assert.deepEqual(
    entries.map((entry) => entry.path),
    ["Home.md", "Alpha/Alpha.md", "Alpha/Bare.md", "Beta/Zed.md", "Seismic/Pipe.md"],
  );
  assert.deepEqual(entries.find((entry) => entry.path === "Seismic/Pipe.md"), {
    path: "Seismic/Pipe.md",
    title: "Seismic | Identity",
    description: "Has | pipes",
  });
  assert.equal(entries.find((entry) => entry.path === "Alpha/Bare.md")?.description, "");
});

test("list reads the built file, filters by folder and honors the limit", async () => {
  const ctx = await makeCtx();
  const manifest = manifestStrategy();
  await manifest.build(DOCS, ctx);
  const paths = async (opts: { pathPrefix?: string; limit?: number }): Promise<string[]> =>
    ((await manifest.list?.(opts, ctx)) ?? []).map((entry) => entry.path);
  assert.deepEqual(await paths({ pathPrefix: "Alpha" }), ["Alpha/Alpha.md", "Alpha/Bare.md"]);
  assert.deepEqual(await paths({ limit: 1 }), ["Home.md"]);
  assert.deepEqual(await paths({ pathPrefix: "Alp" }), []);
  assert.equal((await paths({})).length, 4);
});

test("list before any build explains what to do", async () => {
  const ctx = await makeCtx();
  await assert.rejects(manifestStrategy().list?.({}, ctx) ?? Promise.resolve([]), /`build`/);
});

test("input order does not change the output", () => {
  assert.equal(renderManifestBody(DOCS), renderManifestBody([...DOCS].reverse()));
});

test("a vault with zero notes still builds", async () => {
  const ctx = await makeCtx();
  await manifestStrategy().build([], ctx);
  const text = await readFile(path.join(ctx.vaultRoot, "Manifest.md"), "utf8");
  assert.ok(text.startsWith("# Manifest\n"), text);
});

test("the file is a plain listing: no frontmatter and no note-style breadcrumb", async () => {
  const ctx = await makeCtx();
  await manifestStrategy().build(DOCS, ctx);
  const text = await readFile(path.join(ctx.vaultRoot, "Manifest.md"), "utf8");
  assert.ok(text.startsWith("# Manifest\n"), text);
  assert.ok(!text.includes("---"), text);
  assert.ok(!text.includes("Up:"), text);
});

test("rebuilding the same docs gives a byte-identical file", async () => {
  const ctx = await makeCtx();
  const target = path.join(ctx.vaultRoot, "Manifest.md");
  await manifestStrategy().build(DOCS, ctx);
  const before = await readFile(target, "utf8");
  await manifestStrategy().build(DOCS, ctx);
  assert.equal(await readFile(target, "utf8"), before);
});

test("a changed note changes the file", async () => {
  const ctx = await makeCtx();
  const target = path.join(ctx.vaultRoot, "Manifest.md");
  await manifestStrategy().build(DOCS, ctx);
  const changed = [...DOCS, makeDoc({ path: "Home2.md", title: "Home2", description: "New" })];
  await manifestStrategy().build(changed, ctx);
  assert.match(await readFile(target, "utf8"), /\[\[Home2\|Home2\]\]/);
});
