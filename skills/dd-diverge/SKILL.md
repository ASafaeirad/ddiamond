---
name: dd-diverge
description: Step two for the ddiamond workflow. Build a generation of rival throwaway POCs for a problem, each one arguing a different answer, and hand them over in a dashboard to be graded. Run it again to breed the next generation from the verdicts.
argument-hint: "Optional --exploration <slug> when several are open"
disable-model-invocation: true
---

# dd-diverge

Divergence is the phase where you refuse to pick. You build cheap rivals and let the user judge by *using* them, because taste cannot be settled in prose.

This skill runs **one generation** per invocation. Generation 1 spans the open axes. Every generation after breeds from the verdicts the user left in the dashboard, so the run gets sharper each time without ever collapsing to a single line of thinking.

Everything the skill knows lives in `manifest.yaml`. **Read it directly; write only through `ddiamond`.**

## The loop

```
ddiamond next-gen  →  ddiamond add ×N  →  parallel subagents build  →  user grades in the dashboard  →  repeat
```

## Process

### 1. Load the exploration

Read `problem.md` and `manifest.yaml` from the exploration directory (`ddiamond list --json` prints the manifest if you would rather not resolve the path yourself). If neither exists, the user has skipped discovery. Point them at `/dd-discover` rather than inventing a problem statement.

`current_generation` tells you which branch of this skill you are on.

### 2a. Generation 1, span the axes

Read the **Axes of disagreement** in `problem.md`. Derive **4 theses**: coherent, genuinely rivalrous positions that between them cover the disagreements that matter most.

<spanning-rules>

- **Never the cartesian product.** Three axes of two options is eight variants and nobody looks at eight. Each variant must justify its slot by what it settles that no sibling settles.
- Each variant is **a coherent whole someone could plausibly ship**, not a row in a truth table.
- They must differ on **the axis of the argument**, meaning the actual disagreement, not the decoration. Four shades of one idea is a failed generation however polished each one is.
- If four cannot span the axes, the exploration is too wide. Say so and narrow it with the user rather than building a pile.

</spanning-rules>

**Generation 1 is the only one with an approval gate.** Present the four as a numbered list. For each, give its name, one-line thesis, and the question it settles. Iterate until the user approves. The first generation fixes the space everything after grows inside, so a misread here is expensive. Every later generation derives from the user's own verdicts and needs no gate.

### 2b. Generation 2+, breed from the verdicts

`ddiamond next-gen` **will refuse** while any variant is still `pending`. That is deliberate: an ungraded variant is a silent hole in the input. If it refuses, tell the user which variants need grading and stop.

Read every `kept` variant and its comment. The comment is the signal. It names the property that earned the variant its life.

Allocate **4 slots**:

- **3 children.** Split across the `kept` variants proportionally. Two keeps means two children of one and one of the other; use your judgement on which deserves the extra. Each child records `--parent <id>` and must:
  - **preserve** the property the comment praised, and
  - **vary what the comment did not mention.** This is the actual mechanic of the whole system. The user said the density was right and said nothing about the navigation, so the density is frozen and the navigation is what this generation argues about.
- **1 wildcard**, added with `--wildcard`. A deliberately unrelated direction, not descended from anything. It is cheap insurance against converging on a local maximum by generation 2.

**No approval gate.** State the four theses in a line each and build.

Also read the `rejected` comments before you start. They are negative constraints. Never spend a slot re-proposing something the user has already killed and explained.

### 3. Reserve the slots

```
ddiamond next-gen
ddiamond add --thesis "<one line>" --varies "<what this changes vs its parent>" [--parent <id>] [--wildcard]
```

Each `ddiamond add` prints the allocated id and its directory. Reserve **all four before building any of them**. The ids and paths are what the subagents get told to write into.

### 4. Build, in parallel

Launch **one subagent per variant, all in the same message** so they run concurrently. Each gets a fresh context and knows only its own variant.

Each subagent prompt must contain:

- The variant's **id** and its absolute **directory**. It writes `index.html` there and touches nothing else.
- Its **thesis**, and what it varies from its parent.
- The relevant parts of `problem.md`: the problem, what good looks like, and the constraints.
- If it has a parent: the parent's `index.html` **inlined**, and the parent's verdict comment. The child is a mutation of a specific thing, not a fresh take on the theme.
- An instruction to **read `FIDELITY.md` from this skill's directory before writing anything**, and that its contract is binding.
- A short **deliberately-not-built** list for this variant.

Never let a subagent invent its own id, choose its own path, or touch `manifest.yaml`.

### 5. Hand over

Print the four theses, one line each, and:

```
cd <exploration dir> && ddiamond serve
```

Then **stop talking**. Do not verify that the variants render. The user is about to look at them, and a broken card is information too. Do not summarise what you built beyond the theses. The user is here to react to pixels, not to read.

### 6. When the user comes back

They will either ask for changes to a specific variant or ask for the next generation, which is step 2b again. Apply changes directly, keep the turnaround short, and push back only if a request drifts a variant out of throwaway territory.

When the user marks a variant `final` in the dashboard, this skill is done. `/dd-converge` is next.
