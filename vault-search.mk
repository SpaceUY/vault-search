# Make targets for the vault-search skill (see SKILL.md and DESIGN.md next to this file).
# Include it from the vault's root Makefile:
#
#   include .claude/skills/vault-search/vault-search.mk
#
# The first run installs the tool's single dependency; nobody has to type pnpm.
# Command-line variables (q, path, limit) reach the recipes as environment
# variables, so they are always passed to the tool as one safely quoted argument.
# Recipes run from the vault root, where the tool finds .vault-search/config.json.

TOOL := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))
CLI  := node --disable-warning=ExperimentalWarning $(TOOL)/src/cli.ts

.DEFAULT_GOAL := help
.PHONY: help node-check index search list test

help:
	@echo "make index                        build the local manifest and search index"
	@echo "make search q=\"<terms>\"           ranked keyword search (optional: path=<folder> limit=<n>)"
	@echo "make list [path=<folder>]         browse notes: 'path | description' lines (optional: limit=<n>)"
	@echo "make test                         run the tool's own tests"

node-check:
	@node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>=24||(a===23&&b>=6)||(a===22&&b>=18)?0:1)' \
		|| { echo "Node 22.18 or later is required (found $$(node -v))"; exit 1; }

$(TOOL)/node_modules: $(TOOL)/package.json $(TOOL)/pnpm-lock.yaml
	@$(MAKE) --no-print-directory node-check
	@command -v pnpm >/dev/null || { echo "pnpm is needed once, to install the tool's dependency (https://pnpm.io/installation)"; exit 1; }
	pnpm --dir $(TOOL) install --frozen-lockfile
	@touch $@

index: $(TOOL)/node_modules
	@$(CLI) build

search: $(TOOL)/node_modules
	@test -n "$$q" || { echo 'usage: make search q="<terms>" [path=<folder>] [limit=<n>]'; exit 1; }
	@$(CLI) query "$$q" $${path:+--path "$$path"} $${limit:+--limit "$$limit"}

list: $(TOOL)/node_modules
	@$(CLI) list $${path:+--path "$$path"} $${limit:+--limit "$$limit"}

test: $(TOOL)/node_modules
	@pnpm --dir $(TOOL) test
