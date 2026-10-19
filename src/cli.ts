import { realpathSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import type { SearchConfig } from "./config.ts";
import { createStrategies } from "./registry.ts";
import type { Ctx, Hit, Strategy } from "./types.ts";
import { readVault } from "./vault-reader.ts";

// The config belongs to the vault, not to the tool: by default it is read from the current directory (the vault root).
const DEFAULT_CONFIG = path.join(".vault-search", "config.json");
const DEFAULT_LIMIT = 10;
const USAGE = `Usage:
  search build [--strategy <name>]
  search query <text> [--strategy <name>] [--path <folder>] [--limit <n>]
  search list [--strategy <name>] [--path <folder>] [--limit <n>]
Every command also takes --config <file> (default: ./${DEFAULT_CONFIG}).`;

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

interface QueryOptions {
  strategy: string | undefined;
  pathPrefix: string | undefined;
  limit: number;
}

interface ListOptions {
  strategy: string | undefined;
  pathPrefix: string | undefined;
  limit: number | undefined;
}

function selectStrategies(config: SearchConfig, name: string | undefined): Strategy[] {
  const enabled = createStrategies(config.strategies);
  if (name === undefined) return enabled;
  const selected = enabled.filter((strategy) => strategy.name === name);
  if (selected.length === 0) {
    throw new Error(`Strategy "${name}" is not enabled. Enabled: ${config.strategies.join(", ")}`);
  }
  return selected;
}

function toCtx(config: SearchConfig): Ctx {
  return { vaultRoot: config.vaultRoot, indexDir: config.indexDir };
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  return limit;
}

function formatHit(hit: Hit): string {
  return `${hit.path} | ${hit.description} | ${hit.score.toPrecision(3)}`;
}

async function runBuild(config: SearchConfig, strategyName: string | undefined, io: Io): Promise<void> {
  const strategies = selectStrategies(config, strategyName);
  const docs = await readVault(config.vaultRoot, config.ignore, io.err);
  for (const strategy of strategies) {
    await strategy.build(docs, toCtx(config));
    io.out(`built ${strategy.name} (${docs.length} notes)`);
  }
}

async function runQuery(config: SearchConfig, text: string, options: QueryOptions, io: Io): Promise<void> {
  const strategies = selectStrategies(config, options.strategy);
  for (const strategy of strategies) {
    if (strategy.search === undefined) continue;
    const hits = await strategy.search(
      text,
      { limit: options.limit, pathPrefix: options.pathPrefix },
      toCtx(config),
    );
    for (const hit of hits) io.out(formatHit(hit));
    return;
  }
  throw new Error(
    options.strategy === undefined
      ? "No enabled strategy supports query"
      : `Strategy "${options.strategy}" does not support query`,
  );
}

async function runList(config: SearchConfig, options: ListOptions, io: Io): Promise<void> {
  for (const strategy of selectStrategies(config, options.strategy)) {
    if (strategy.list === undefined) continue;
    const entries = await strategy.list(
      { pathPrefix: options.pathPrefix, limit: options.limit },
      toCtx(config),
    );
    for (const entry of entries) io.out(`${entry.path} | ${entry.description}`);
    return;
  }
  throw new Error(
    options.strategy === undefined
      ? "No enabled strategy supports list"
      : `Strategy "${options.strategy}" does not support list`,
  );
}

export async function run(argv: string[], io: Io, configPath?: string): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        strategy: { type: "string" },
        path: { type: "string" },
        limit: { type: "string" },
        config: { type: "string" },
      },
    });
    const [command, ...words] = positionals;
    if (command !== "build" && command !== "query" && command !== "list") {
      io.err(USAGE);
      return 1;
    }
    const config = await loadConfig(configPath ?? values.config ?? path.resolve(DEFAULT_CONFIG));
    if (command === "build") {
      await runBuild(config, values.strategy, io);
      return 0;
    }
    const limit = parseLimit(values.limit);
    if (command === "list") {
      if (words.length > 0) throw new Error("list takes no search text, use --path to pick a folder");
      await runList(config, { strategy: values.strategy, pathPrefix: values.path, limit }, io);
      return 0;
    }
    const text = words.join(" ").trim();
    if (text === "") throw new Error("query needs search text");
    await runQuery(
      config,
      text,
      { strategy: values.strategy, pathPrefix: values.path, limit: limit ?? DEFAULT_LIMIT },
      io,
    );
    return 0;
  } catch (error) {
    io.err(`search: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2), { out: console.log, err: console.error });
}
