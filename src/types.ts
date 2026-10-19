export interface Doc {
  path: string;
  title: string;
  description: string;
  tags: string[];
  status: string | null;
  headings: string[];
  body: string;
  hash: string;
}

export interface Hit {
  path: string;
  title: string;
  description: string;
  score: number;
}

export interface SearchOpts {
  limit: number;
  pathPrefix?: string;
}

export interface ListOpts {
  pathPrefix?: string;
  limit?: number;
}

export interface ListEntry {
  path: string;
  title: string;
  description: string;
}

export interface Ctx {
  vaultRoot: string;
  indexDir: string;
}

export interface Strategy {
  name: string;
  build(docs: Doc[], ctx: Ctx): Promise<void>;
  search?(query: string, opts: SearchOpts, ctx: Ctx): Promise<Hit[]>;
  list?(opts: ListOpts, ctx: Ctx): Promise<ListEntry[]>;
}
