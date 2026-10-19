import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareCodeUnits } from "../compare.ts";
import { normalizePrefix } from "../prefix.ts";
import type { Ctx, Doc, ListEntry, ListOpts, Strategy } from "../types.ts";

const FILE_NAME = "Manifest.md";
const ROOT_GROUP = "Root";
// The same separator the existing LLM-generated manifest uses, written as an escape.
const SEPARATOR = " — ";
const INTRO =
  "Generated index of every vault note with a one-line description. Built locally by the search tool (`make index`) and gitignored. Do not edit by hand; browse it with `make list`.";
const ENTRY = /^- \[\[([^|\]]+)\|(.*?)\]\](?: — (.*))?$/;

function groupName(docPath: string): string {
  const slash = docPath.indexOf("/");
  return slash === -1 ? ROOT_GROUP : docPath.slice(0, slash);
}

function compareGroups(a: string, b: string): number {
  if (a === b) return 0;
  if (a === ROOT_GROUP) return -1;
  if (b === ROOT_GROUP) return 1;
  return compareCodeUnits(a, b);
}

function renderEntry(doc: Doc): string {
  const link = `[[${doc.path.replace(/\.md$/, "")}|${doc.title}]]`;
  return doc.description === "" ? `- ${link}` : `- ${link}${SEPARATOR}${doc.description}`;
}

export function renderManifestBody(docs: Doc[]): string {
  const groups = new Map<string, Doc[]>();
  const sorted = [...docs].sort((a, b) => compareCodeUnits(a.path, b.path));
  for (const doc of sorted) {
    const name = groupName(doc.path);
    groups.set(name, [...(groups.get(name) ?? []), doc]);
  }
  const sections = [...groups.keys()].sort(compareGroups).map((name) => {
    const entries = (groups.get(name) ?? []).map(renderEntry).join("\n");
    return `## ${name}\n${entries}`;
  });
  const listing = sections.length === 0 ? "" : `${sections.join("\n\n")}\n`;
  return `# Manifest\n\n${INTRO}\n\n${listing}`;
}

export function parseManifestEntries(text: string): ListEntry[] {
  return text.split("\n").flatMap((line): ListEntry[] => {
    const match = ENTRY.exec(line);
    const target = match?.[1];
    const title = match?.[2];
    if (target === undefined || title === undefined) return [];
    return [{ path: `${target}.md`, title, description: match?.[3] ?? "" }];
  });
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readManifestText(target: string): Promise<string> {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if (isNotFound(error)) throw new Error(`${FILE_NAME} not found, run \`build\` first`);
    throw error;
  }
}

async function build(docs: Doc[], ctx: Ctx): Promise<void> {
  await writeFile(path.join(ctx.vaultRoot, FILE_NAME), renderManifestBody(docs));
}

async function list(opts: ListOpts, ctx: Ctx): Promise<ListEntry[]> {
  const text = await readManifestText(path.join(ctx.vaultRoot, FILE_NAME));
  const prefix = normalizePrefix(opts.pathPrefix);
  const entries = parseManifestEntries(text).filter((entry) => entry.path.startsWith(prefix));
  return opts.limit === undefined ? entries : entries.slice(0, opts.limit);
}

export function manifestStrategy(): Strategy {
  return { name: "manifest", build, list };
}
