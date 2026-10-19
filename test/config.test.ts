import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";

async function writeConfig(content: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "search-config-"));
  const file = path.join(dir, "search.config.json");
  await writeFile(file, content);
  return file;
}

test("resolves vaultRoot relative to the config file and places the index beside it", async () => {
  const file = await writeConfig(
    JSON.stringify({ vaultRoot: "../vault", ignore: ["Images"], strategies: ["fts"] }),
  );
  const config = await loadConfig(file);
  const dir = path.dirname(file);
  assert.equal(config.vaultRoot, path.resolve(dir, "../vault"));
  assert.equal(config.indexDir, path.join(dir, ".index"));
  assert.deepEqual(config.ignore, ["Images"]);
  assert.deepEqual(config.strategies, ["fts"]);
});

test("ignore defaults to an empty list", async () => {
  const file = await writeConfig(JSON.stringify({ vaultRoot: ".", strategies: ["fts"] }));
  assert.deepEqual((await loadConfig(file)).ignore, []);
});

test("rejects a config that is not a JSON object", async () => {
  const file = await writeConfig("[]");
  await assert.rejects(loadConfig(file), /expected a JSON object/);
});

test("rejects a non-string vaultRoot", async () => {
  const file = await writeConfig(JSON.stringify({ vaultRoot: 3, strategies: ["fts"] }));
  await assert.rejects(loadConfig(file), /"vaultRoot" must be a string/);
});

test("rejects missing or empty strategies", async () => {
  const missing = await writeConfig(JSON.stringify({ vaultRoot: "." }));
  await assert.rejects(loadConfig(missing), /"strategies" must be a non-empty array/);
  const empty = await writeConfig(JSON.stringify({ vaultRoot: ".", strategies: [] }));
  await assert.rejects(loadConfig(empty), /"strategies" must be a non-empty array/);
});

test("rejects a non-array ignore list", async () => {
  const file = await writeConfig(
    JSON.stringify({ vaultRoot: ".", ignore: "Images", strategies: ["fts"] }),
  );
  await assert.rejects(loadConfig(file), /"ignore" must be an array of strings/);
});
