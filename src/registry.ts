import { ftsStrategy } from "./strategies/fts.ts";
import { manifestStrategy } from "./strategies/manifest.ts";
import type { Strategy } from "./types.ts";

const FACTORIES = new Map<string, () => Strategy>([
  ["manifest", () => manifestStrategy()],
  ["fts", ftsStrategy],
]);

export function createStrategies(names: string[]): Strategy[] {
  return names.map((name) => {
    const factory = FACTORIES.get(name);
    if (factory === undefined) {
      throw new Error(`Unknown strategy "${name}". Available: ${[...FACTORIES.keys()].join(", ")}`);
    }
    return factory();
  });
}
