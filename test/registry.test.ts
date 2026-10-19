import assert from "node:assert/strict";
import { test } from "node:test";
import { createStrategies } from "../src/registry.ts";

test("creates strategies in the requested order", () => {
  assert.deepEqual(
    createStrategies(["fts", "manifest"]).map((strategy) => strategy.name),
    ["fts", "manifest"],
  );
});

test("an unknown name fails fast and lists the available strategies", () => {
  assert.throws(() => createStrategies(["nope"]), /Unknown strategy "nope"\. Available: manifest, fts/);
});

test("names inherited from Object.prototype are not strategies", () => {
  assert.throws(() => createStrategies(["constructor"]), /Unknown strategy "constructor"/);
});
