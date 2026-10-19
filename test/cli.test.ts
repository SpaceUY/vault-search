import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { run } from "../src/cli.ts";
import type { Io } from "../src/cli.ts";

const FIXTURE_VAULT = fileURLToPath(new URL("./fixtures/vault", import.meta.url));
const execFileAsync = promisify(execFile);

interface Sandbox {
  configPath: string;
  vaultRoot: string;
}

async function makeSandbox(strategies: string[] = ["manifest", "fts"]): Promise<Sandbox> {
  const root = await mkdtemp(path.join(tmpdir(), "search-cli-"));
  const vaultRoot = path.join(root, "vault");
  await cp(FIXTURE_VAULT, vaultRoot, { recursive: true });
  await mkdir(path.join(root, "tools"));
  const configPath = path.join(root, "tools", "search.config.json");
  await writeFile(
    configPath,
    JSON.stringify({ vaultRoot: "../vault", ignore: ["Images", "Templates", "Manifest.md"], strategies }),
  );
  return { configPath, vaultRoot };
}

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

test("build runs every enabled strategy", async () => {
  const { configPath, vaultRoot } = await makeSandbox();
  const { io, out, err } = capture();
  const code = await run(["build"], io, configPath);
  assert.equal(code, 0);
  assert.deepEqual(out, ["built manifest (7 notes)", "built fts (7 notes)"]);
  assert.match(await readFile(path.join(vaultRoot, "Manifest.md"), "utf8"), /# Manifest/);
  assert.equal(err.filter((line) => !/malformed frontmatter/.test(line)).length, 0);
});

test("build --strategy runs only the named strategy", async () => {
  const { configPath, vaultRoot } = await makeSandbox();
  const { io, out } = capture();
  assert.equal(await run(["build", "--strategy", "fts"], io, configPath), 0);
  assert.deepEqual(out, ["built fts (7 notes)"]);
  await assert.rejects(readFile(path.join(vaultRoot, "Manifest.md"), "utf8"), /ENOENT/);
});

test("query prints path, description and score for each hit", async () => {
  const { configPath } = await makeSandbox();
  await run(["build"], capture().io, configPath);
  const { io, out } = capture();
  assert.equal(await run(["query", "rollout"], io, configPath), 0);
  assert.equal(out.length, 1);
  assert.match(out[0] ?? "", /^Alpha\/Deploy Guide\.md \| How to roll out a release with zero downtime \| \d/);
});

test("query joins all words and honors --path and --limit", async () => {
  const { configPath } = await makeSandbox();
  await run(["build"], capture().io, configPath);
  const { io, out } = capture();
  assert.equal(
    await run(["query", "credentials", "zebra", "--path", "Beta", "--limit", "1"], io, configPath),
    0,
  );
  assert.equal(out.length, 1);
  assert.ok((out[0] ?? "").startsWith("Beta/"));
});

test("a query with no hits exits zero with no output", async () => {
  const { configPath } = await makeSandbox();
  await run(["build"], capture().io, configPath);
  const { io, out, err } = capture();
  assert.equal(await run(["query", "nonexistentterm"], io, configPath), 0);
  assert.deepEqual([out, err], [[], []]);
});

test("a second build does not index the generated manifest", async () => {
  const { configPath } = await makeSandbox();
  await run(["build"], capture().io, configPath);
  await run(["build"], capture().io, configPath);
  const { io, out } = capture();
  assert.equal(await run(["query", "generated"], io, configPath), 0);
  assert.deepEqual(out, []);
});

test("an unknown strategy in the config fails fast", async () => {
  const { configPath } = await makeSandbox(["fts", "bogus"]);
  const { io, err } = capture();
  assert.equal(await run(["build"], io, configPath), 1);
  assert.match(err.join("\n"), /Unknown strategy "bogus"/);
});

test("--strategy must name an enabled strategy", async () => {
  const { configPath } = await makeSandbox(["fts"]);
  const { io, err } = capture();
  assert.equal(await run(["build", "--strategy", "manifest"], io, configPath), 1);
  assert.match(err.join("\n"), /not enabled/);
});

test("querying a build-only strategy is an error", async () => {
  const { configPath } = await makeSandbox();
  await run(["build"], capture().io, configPath);
  const { io, err } = capture();
  assert.equal(await run(["query", "x", "--strategy", "manifest"], io, configPath), 1);
  assert.match(err.join("\n"), /does not support query/);
});

test("querying before any build explains what to do", async () => {
  const { configPath } = await makeSandbox();
  const { io, err } = capture();
  assert.equal(await run(["query", "rollout"], io, configPath), 1);
  assert.match(err.join("\n"), /`build`/);
});

test("list prints path and description for a folder, in manifest order", async () => {
  const { configPath } = await makeSandbox();
  await run(["build"], capture().io, configPath);
  const { io, out } = capture();
  assert.equal(await run(["list", "--path", "Alpha"], io, configPath), 0);
  assert.deepEqual(out, [
    "Alpha/Alpha.md | Index of the Alpha notes",
    "Alpha/Deploy Guide.md | How to roll out a release with zero downtime",
    "Alpha/Folded.md | multi line text",
  ]);
});

test("list without a folder starts with the root notes and honors --limit", async () => {
  const { configPath } = await makeSandbox();
  await run(["build"], capture().io, configPath);
  const { io, out } = capture();
  assert.equal(await run(["list", "--limit", "2"], io, configPath), 0);
  assert.deepEqual(out, [
    "Home.md | Entry point for the fixture vault",
    "Alpha/Alpha.md | Index of the Alpha notes",
  ]);
});

test("list for an unknown folder exits zero with no output", async () => {
  const { configPath } = await makeSandbox();
  await run(["build"], capture().io, configPath);
  const { io, out, err } = capture();
  assert.equal(await run(["list", "--path", "Nowhere"], io, configPath), 0);
  assert.deepEqual([out, err], [[], []]);
});

test("list before any build explains what to do", async () => {
  const { configPath } = await makeSandbox();
  const { io, err } = capture();
  assert.equal(await run(["list"], io, configPath), 1);
  assert.match(err.join("\n"), /`build`/);
});

test("list on a strategy that cannot list is an error, and list takes no free text", async () => {
  const { configPath } = await makeSandbox();
  await run(["build"], capture().io, configPath);
  const first = capture();
  assert.equal(await run(["list", "--strategy", "fts"], first.io, configPath), 1);
  assert.match(first.err.join("\n"), /does not support list/);
  const second = capture();
  assert.equal(await run(["list", "extra"], second.io, configPath), 1);
  assert.match(second.err.join("\n"), /list takes no search text/);
});

test("running the entry point through a symlinked directory still runs the CLI", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "search-link-"));
  const link = path.join(dir, "linked-src");
  await symlink(fileURLToPath(new URL("../src", import.meta.url)), link, "dir");
  const result = await execFileAsync(process.execPath, [
    "--disable-warning=ExperimentalWarning",
    path.join(link, "cli.ts"),
  ]).catch((error: { code: number; stderr: string }) => error);
  assert.equal("code" in result ? result.code : 0, 1);
  assert.match("stderr" in result ? result.stderr : "", /Usage:/);
});

test("bad usage prints usage and exits non-zero", async () => {
  const { configPath } = await makeSandbox();
  const badInvocations = [
    [],
    ["wat"],
    ["query"],
    ["query", "x", "--limit", "0"],
    ["query", "x", "--limit", "abc"],
    ["build", "--nope"],
  ];
  for (const argv of badInvocations) {
    const { io, err } = capture();
    assert.equal(await run(argv, io, configPath), 1, JSON.stringify(argv));
    assert.ok(err.length > 0, JSON.stringify(argv));
  }
});
