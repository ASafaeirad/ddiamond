# ddiamond - agentic double diamond

`ddiamond` is a tooling for the **discover → define** half of double-diamond design: turn a raw problem into batches of cheap, running proofs of concept, grade them side by side in a dashboard, breed the survivors into the next generation, and converge on a spec.

The idea it is built around: you cannot pick a direction by arguing about it. You pick it by using four of them and noticing which one you keep reaching for. So the system's job is to make building four rivals cheap, and to remember what you thought of each one.

```
/dd-discover  →  problem.md
                     ↓
/dd-diverge   →  gen-01: four rivals  →  dd serve  →  you grade them
                     ↓
/dd-diverge   →  gen-02: 3 children of the keeps + 1 wildcard
                     ↓
                  … until one is marked final
                     ↓
/dd-converge  →  spec.md, for the second diamond
```

## Prerequisites

- [Deno](https://deno.com)

## Install

```bash
./install.sh
```

Symlinks the three skills into `~/.agents/skills/` and `tool/ddiamond.ts` to `~/.local/bin/ddiamond`.
Edits in this repo are live immediately, there is no reinstall step.

Override the destinations with `DD_SKILL_DIR` and `DD_BIN_DIR`.

## What it produces

```
.scratch/<slug>/
  problem.md       written by /dd-discover
  manifest.yaml    the single source of truth
  spec.md          written by /dd-converge
  gen-01/g1-01/index.html
  gen-01/g1-02/index.html
  gen-02/g2-01/index.html
  …
```

A **variant** is a directory with an `index.html` the dashboard renders in an iframe. A variant's path is derivable from its id alone, so nothing ever has to go looking.

## The rules the tool enforces

These are the parts that are load-bearing, so `ddiamond` refuses rather than warns:

- **A verdict needs a comment.** "Why it survived" is exactly what the next generation reads. A blank one degrades every generation after it, and blank is always the easiest thing to leave.
- **A new generation is blocked while anything is pending.** An ungraded variant is a silent hole in the input.
- **Exactly one variant can be `final`.** Marking a new one demotes the previous winner back to `kept`.
- **Six variants per generation, maximum.** Four is the default. Nobody reviews eight.
- **Nothing is ever deleted.** Rejected variants stay on disk and stay openable; the dashboard just hides them by default.

## How generations breed

Each `kept` variant's comment names the property that earned it its life. A child **freezes that property and varies what the comment did not mention**
you said the density was right and said nothing about the navigation, so the density is fixed and the navigation is what this round argues about.

One slot per generation is a **wildcard**: unrelated to anything, descended from nothing. It is cheap insurance against converging on a local maximum by generation 2.

## `ddiamond`

```
ddiamond init --slug <slug> [--title <title>]     scaffold .scratch/<slug>/
ddiamond next-gen                                 start the next generation
ddiamond ddiamond --thesis <t> --varies <v> [--parent <id>] [--wildcard]
ddiamond set-status <id> --status kept|rejected --comment "…"
ddiamond final <id> --comment "…"
ddiamond list [--json] [--generation N] [--status S]
ddiamond serve [--port N]                         dashboard, default 7337
```

The exploration is resolved by walking up from the cwd to a `.scratch` directory, git-style. When more than one exploration is open, pass `--exploration <slug>`.

## For agents

Read `manifest.yaml` directly, it is the whole tree in one file. **Write only through `ddiamond`.** The CLI and the dashboard's HTTP API call the same mutation functions, so the schema has exactly one writer and cannot drift; a second writer is how it would.

```yaml
slug: dark-mode
title: Dark mode toggle
created: '2026-08-12'
current_generation: 2
variants:
  - id: g2-01
    generation: 2
    parent: g1-02          # null for roots and wildcards
    wildcard: false
    thesis: Segmented control, denser.
    varies: Tightens spacing; keeps the instant read.
    status: kept           # pending | kept | rejected | final
    comment: Denser is better - 40% tighter.
    created: '2026-08-12'
```
