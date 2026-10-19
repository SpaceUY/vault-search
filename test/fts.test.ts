import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ftsStrategy, toMatchExpression } from "../src/strategies/fts.ts";
import type { Ctx, Doc } from "../src/types.ts";
import { readVault } from "../src/vault-reader.ts";
import { makeDoc } from "./helpers.ts";

const FIXTURE_VAULT = fileURLToPath(new URL("./fixtures/vault", import.meta.url));

async function makeCtx(): Promise<Ctx> {
  const dir = await mkdtemp(path.join(tmpdir(), "search-fts-"));
  return { vaultRoot: dir, indexDir: path.join(dir, "missing", ".index") };
}

async function fixtureDocs(): Promise<Doc[]> {
  return readVault(FIXTURE_VAULT, ["Images", "Templates"], () => undefined);
}

async function searchPaths(
  query: string,
  ctx: Ctx,
  opts: { limit?: number; pathPrefix?: string } = {},
): Promise<string[]> {
  const hits = await ftsStrategy().search?.(query, { limit: opts.limit ?? 10, ...opts }, ctx);
  return (hits ?? []).map((hit) => hit.path);
}

test("toMatchExpression quotes each word and joins them with OR", () => {
  assert.equal(toMatchExpression("Rollout canary!"), '"Rollout" OR "canary"');
  assert.equal(toMatchExpression("***"), "");
  assert.equal(toMatchExpression(""), "");
});

test("builds into an index directory that does not exist yet and finds a note", async () => {
  const ctx = await makeCtx();
  const fts = ftsStrategy();
  await fts.build(await fixtureDocs(), ctx);
  assert.deepEqual((await searchPaths("rollout", ctx))[0], "Alpha/Deploy Guide.md");
});

test("hits carry title, description and a positive score", async () => {
  const ctx = await makeCtx();
  const fts = ftsStrategy();
  await fts.build(await fixtureDocs(), ctx);
  const hits = (await fts.search?.("credentials", { limit: 5 }, ctx)) ?? [];
  assert.equal(hits[0]?.path, "Beta/Rotating Credentials.md");
  assert.equal(hits[0]?.title, "Rotating Credentials");
  assert.equal(hits[0]?.description, "Rotate database credentials every quarter");
  assert.ok((hits[0]?.score ?? 0) > 0);
});

test("stemming matches word variants", async () => {
  const ctx = await makeCtx();
  await ftsStrategy().build(await fixtureDocs(), ctx);
  assert.equal((await searchPaths("rollouts", ctx))[0], "Alpha/Deploy Guide.md");
});

test("title and description matches outrank body-only matches", async () => {
  const ctx = await makeCtx();
  await ftsStrategy().build(
    [
      makeDoc({ path: "body.md", title: "Other", body: "zebra zebra zebra zebra zebra" }),
      makeDoc({ path: "title.md", title: "Zebra", body: "nothing here" }),
    ],
    ctx,
  );
  assert.deepEqual(await searchPaths("zebra", ctx), ["title.md", "body.md"]);
});

test("a rebuild updates changed notes and removes deleted ones", async () => {
  const ctx = await makeCtx();
  const fts = ftsStrategy();
  const keep = makeDoc({ path: "keep.md", body: "stays put" });
  await fts.build(
    [keep, makeDoc({ path: "edit.md", body: "oldword" }), makeDoc({ path: "gone.md", body: "doomed" })],
    ctx,
  );
  await fts.build([keep, makeDoc({ path: "edit.md", body: "newword" })], ctx);
  assert.deepEqual(await searchPaths("oldword", ctx), []);
  assert.deepEqual(await searchPaths("newword", ctx), ["edit.md"]);
  assert.deepEqual(await searchPaths("doomed", ctx), []);
  assert.deepEqual(await searchPaths("stays", ctx), ["keep.md"]);
});

test("an index built without a version stamp is rebuilt even for unchanged content hashes", async () => {
  const ctx = await makeCtx();
  const fts = ftsStrategy();
  const before = makeDoc({ path: "n.md", title: "Oldtitle", hash: "same" });
  await fts.build([before], ctx);
  const db = new DatabaseSync(path.join(ctx.indexDir, "fts.db"));
  db.exec("DROP TABLE IF EXISTS meta");
  db.close();
  await fts.build([{ ...before, title: "Newtitle" }], ctx);
  assert.deepEqual(await searchPaths("newtitle", ctx), ["n.md"]);
  assert.deepEqual(await searchPaths("oldtitle", ctx), []);
});

test("path filter treats the prefix as a folder", async () => {
  const ctx = await makeCtx();
  await ftsStrategy().build(await fixtureDocs(), ctx);
  const inBeta = await searchPaths("credentials OR zebra OR quokka", ctx, { pathPrefix: "Beta" });
  assert.ok(inBeta.length >= 2);
  assert.ok(inBeta.every((p) => p.startsWith("Beta/")));
  assert.deepEqual(await searchPaths("credentials", ctx, { pathPrefix: "Bet" }), []);
});

test("limit caps the number of hits", async () => {
  const ctx = await makeCtx();
  await ftsStrategy().build(await fixtureDocs(), ctx);
  const hits = await searchPaths("alpha OR beta OR vault OR runbook OR zebra OR credentials", ctx, {
    limit: 2,
  });
  assert.equal(hits.length, 2);
});

test("hostile or symbol-only queries never throw", async () => {
  const ctx = await makeCtx();
  await ftsStrategy().build(await fixtureDocs(), ctx);
  const queries = ["AND", "OR NOT", '"unbalanced', "(a OR", "foo*", "NEAR(", "title:rollout", "'", "***", "", "   "];
  for (const query of queries) {
    await assert.doesNotReject(searchPaths(query, ctx), `query ${JSON.stringify(query)}`);
  }
  assert.deepEqual(await searchPaths("***", ctx), []);
});

test("non-ASCII notes match their ASCII spelling and non-ASCII queries work", async () => {
  const ctx = await makeCtx();
  await ftsStrategy().build([makeDoc({ path: "cafe.md", title: "Café notes", body: "über naïve" })], ctx);
  assert.deepEqual(await searchPaths("cafe", ctx), ["cafe.md"]);
  assert.deepEqual(await searchPaths("über", ctx), ["cafe.md"]);
});

test("building an empty vault succeeds and searches return nothing", async () => {
  const ctx = await makeCtx();
  await ftsStrategy().build([], ctx);
  assert.deepEqual(await searchPaths("anything", ctx), []);
});

test("searching before any build explains what to do", async () => {
  const ctx = await makeCtx();
  await assert.rejects(searchPaths("anything", ctx), /`build`/);
});
