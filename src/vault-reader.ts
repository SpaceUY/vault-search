import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { compareCodeUnits } from "./compare.ts";
import type { Doc } from "./types.ts";

const FRONTMATTER = /^---\r?\n(?:---|([\s\S]*?)\r?\n---)[ \t]*(?:\r?\n|$)/;
const HEADING = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^(```|~~~)/;

type Warn = (message: string) => void;

interface Heading {
  level: number;
  text: string;
}

interface Split {
  data: Record<string, unknown>;
  body: string;
}

function splitFrontmatter(relPath: string, text: string, warn: Warn): Split {
  const match = FRONTMATTER.exec(text);
  if (match === null) return { data: {}, body: text };
  const body = text.slice(match[0].length);
  try {
    const parsed: unknown = parse(match[1] ?? "", { logLevel: "error", uniqueKeys: false });
    const isMapping = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    return { data: isMapping ? (parsed as Record<string, unknown>) : {}, body };
  } catch {
    warn(`${relPath}: malformed frontmatter, ignoring it`);
    return { data: {}, body };
  }
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function toTags(value: unknown): string[] {
  const items: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s]+/)
      : [];
  return items
    .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
    .map((item) => String(item).replace(/^#/, ""))
    .filter((tag) => tag !== "");
}

function toStatus(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function extractHeadings(body: string): Heading[] {
  const headings: Heading[] = [];
  let openFence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const marker = FENCE.exec(line)?.[1];
    if (marker !== undefined) {
      if (openFence === null) openFence = marker;
      else if (openFence === marker) openFence = null;
      continue;
    }
    if (openFence !== null) continue;
    const match = HEADING.exec(line);
    const hashes = match?.[1];
    const text = match?.[2];
    if (hashes !== undefined && text !== undefined) headings.push({ level: hashes.length, text });
  }
  return headings;
}

export function parseNote(relPath: string, text: string, warn: Warn): Doc {
  const { data, body } = splitFrontmatter(relPath, text, warn);
  const headings = extractHeadings(body);
  const h1 = headings.find((heading) => heading.level === 1);
  return {
    path: relPath,
    title: h1?.text ?? path.posix.basename(relPath, ".md"),
    description: toText(data["description"]),
    tags: toTags(data["tags"]),
    status: toStatus(data["status"]),
    headings: headings.map((heading) => heading.text),
    body,
    hash: createHash("sha256").update(text).digest("hex"),
  };
}

function isIgnored(relPath: string, ignore: string[]): boolean {
  return ignore.some((entry) => relPath === entry || relPath.startsWith(`${entry}/`));
}

async function collectNotePaths(root: string, relDir: string, ignore: string[]): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(path.join(root, relDir), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    if (isIgnored(relPath, ignore)) continue;
    if (entry.isDirectory()) found.push(...(await collectNotePaths(root, relPath, ignore)));
    else if (entry.isFile() && entry.name.endsWith(".md")) found.push(relPath);
  }
  return found;
}

export async function readVault(
  root: string,
  ignore: string[],
  warn: Warn = (message) => console.error(message),
): Promise<Doc[]> {
  const notePaths = (await collectNotePaths(root, "", ignore)).sort(compareCodeUnits);
  const docs: Doc[] = [];
  for (const notePath of notePaths) {
    const text = await readFile(path.join(root, notePath), "utf8");
    docs.push(parseNote(notePath, text, warn));
  }
  return docs;
}
