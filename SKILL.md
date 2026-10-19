---
name: vault-search
description: Use this skill whenever you need to find notes in the vault - "find notes about X", "what do we have on X", "is there a note on X", "look up X in the vault", "what does the vault say about X". Runs the local ranked search (SQLite FTS5) and falls back to a scoped, description-based listing. Also covers setting the search up in another vault.
version: 1.0.0
---

# Vault Search

Finds notes in an Obsidian vault by running a local search tool over each note's title, `description`, tags, headings and body. Two strategies back it:

- **`fts`** (SQLite FTS5, `porter unicode61` tokenizer, BM25 weighted towards title and description) answers `search`: "which notes match these words?"
- **`manifest`** (a generated `Manifest.md`) answers `list`: "what is in this area?"

Both are driven from the vault root through `make`. The tool's design is in [DESIGN.md](DESIGN.md).

## Finding notes

1. **Search first.** `make search q="<terms>" [path=<folder>] [limit=<n>]` prints `path | description | score` lines, best first. Pass `path=` when the product or area is known. If the top hits look right, open them.
2. **If search misses or returns noise**, fall back to a scoped list. Signs: no hit answers the question, or the top results are only index/MOC notes. The query probably does not share vocabulary with the note ("outage" vs "incident"). Run `make list path=<product or folder>` for the most likely area and pick notes by reading their descriptions. Keep `path=` narrow (a product, or a subfolder such as `Seismic/Discovery`); never list the whole vault.
3. **If neither works**, search by tag (`.scripts/find-by-tag.sh`, if the vault has it) or follow links from the vault's root MOC.
4. **Open the notes you picked** with the Obsidian MCP `read_note` / `read_multiple_notes`, and check each note's `status`: `STALE` and `DEPRECATED` notes are historical.

Other commands: `make index` builds or refreshes the index and manifest (incremental; run it once after cloning and after pulling large changes), `make test` runs the tool's own tests, and `make` alone lists the commands. If a command reports a missing index or manifest, run `make index`.

## Rules

- **Never open `Manifest.md`** with MCP, `Read` or `Grep`. It is generated, gitignored and large; go through `make list`. Never hand-edit or commit it.
- Search quality depends on each note's one-line `description`. A note with a vague or missing description ranks badly and reads badly in a list; fix the description rather than working around it.
- Needs Node 22.18 or later. The first run installs the tool's single dependency and needs `pnpm` once.

## Setting this up in another vault

The skill folder is self-contained; the vault only supplies a config file and a `Makefile` line.

1. **Copy** this folder to `.claude/skills/vault-search/` in the target vault (or install it from wherever the skill is shared).
2. **Add the config** at `.vault-search/config.json` in the vault root:

   ```json
   {
     "vaultRoot": "..",
     "ignore": [".obsidian", ".git", ".claude", "Images", "node_modules", "Manifest.md", "README.md", "CLAUDE.md"],
     "strategies": ["manifest", "fts"]
   }
   ```

   `vaultRoot` is resolved relative to the config file. `ignore` lists vault-relative files or folders to skip; folders and files whose name starts with a dot are always skipped. `strategies` picks what is enabled, in priority order: `search` and `list` run on the first enabled strategy that supports them. The index is stored beside the config, in `.vault-search/.index/`.
3. **Wire up `make`.** Add this line to the vault's root `Makefile` (create it if there is none):

   ```make
   include .claude/skills/vault-search/vault-search.mk
   ```

   The targets are `index`, `search`, `list`, `test` and `help`. If the vault's own Makefile already defines any of those names, rename the targets in `vault-search.mk`.
4. **Ignore the generated files** in `.gitignore`:

   ```
   Manifest.md
   .vault-search/.index/
   .claude/skills/vault-search/node_modules/
   ```
5. **Allow the commands without a prompt** (optional), in `.claude/settings.json`:

   ```json
   { "permissions": { "allow": ["Bash(make search:*)", "Bash(make list:*)"] } }
   ```
6. **Build the index:** `make index`. Then point the vault's `CLAUDE.md` at this skill and keep its guardrails (never open `Manifest.md`; use the skill for finding notes).

The vault's notes should carry a `description` line in their frontmatter, since the manifest and the search ranking lean on it. The tool also reads `tags` from frontmatter.

Without `make`, run the CLI directly from the vault root: `node --disable-warning=ExperimentalWarning .claude/skills/vault-search/src/cli.ts <build|query|list> ...`. Every command accepts `--config <file>` to use a config other than `.vault-search/config.json`.
