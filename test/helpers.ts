import path from "node:path";
import type { Doc } from "../src/types.ts";

export function makeDoc(overrides: Partial<Doc> & Pick<Doc, "path">): Doc {
  const body = overrides.body ?? "";
  return {
    title: path.posix.basename(overrides.path, ".md"),
    description: "",
    tags: [],
    status: null,
    headings: [],
    body,
    hash: `hash:${overrides.path}:${body}`,
    ...overrides,
  };
}
