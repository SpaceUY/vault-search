import { readFile } from "node:fs/promises";
import path from "node:path";

export interface SearchConfig {
  vaultRoot: string;
  indexDir: string;
  ignore: string[];
  strategies: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export async function loadConfig(configPath: string): Promise<SearchConfig> {
  const raw: unknown = JSON.parse(await readFile(configPath, "utf8"));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${configPath}: expected a JSON object`);
  }
  const { vaultRoot, ignore = [], strategies } = raw as Record<string, unknown>;
  if (typeof vaultRoot !== "string") {
    throw new Error(`${configPath}: "vaultRoot" must be a string`);
  }
  if (!isStringArray(ignore)) {
    throw new Error(`${configPath}: "ignore" must be an array of strings`);
  }
  if (!isStringArray(strategies) || strategies.length === 0) {
    throw new Error(`${configPath}: "strategies" must be a non-empty array of strings`);
  }
  const configDir = path.dirname(path.resolve(configPath));
  return {
    vaultRoot: path.resolve(configDir, vaultRoot),
    indexDir: path.join(configDir, ".index"),
    ignore,
    strategies,
  };
}
