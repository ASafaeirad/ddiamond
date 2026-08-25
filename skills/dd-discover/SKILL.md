---
name: dd-discover
description: First step of the ddiamond workflow. Interview the user about a raw problem, expose the directions worth testing as POCs, then scaffold the exploration that divergence will fill.
argument-hint: "The problem, however loosely stated"
disable-model-invocation: true
---

# dd-discover

The user has arrived with a problem, not a solution. This skill's whole job is to make the **problem** sharp enough that rival solutions can be built against it and then get out of the way.

You are **not** designing anything here. Every pull toward "we could build it like…" is the signal that you have finished discovering and should stop.

Output: `.scratch/<slug>/problem.md` plus a scaffolded exploration.

## Process

### 1. Grill

Invoke the `/grilling` skill and run it properly. Rounds, frontier, a recommended answer on every question, wait for the user between rounds. Do not summarize the technique and skip it; the interview *is* the deliverable.

Steer the grilling at the **problem**, not the design:

- Who has this problem, and what do they do today instead?
- What makes the current situation actually bad? Cost, time, error, frustration? How would you know it got better?
- What is fixed and cannot be renegotiated? What only *looks* fixed?
- What would make this whole effort not worth doing?
- Which parts of this are you certain about, and which are you guessing at?

That last question is the important one. The answers the user is uncertain about are candidates for the axes that generation 1 will span by building rivals. A problem statement with no axes has nothing to diverge on, and the exploration will produce four variants of the same idea.

Once the problem-focused frontier is empty, run a dedicated **axis round** before asking the user to confirm shared understanding.

For each genuine uncertainty, ask one multiple-choice question about the directions worth testing as POCs:

- Offer 2-4 concrete, contrasting choices. Describe the experience or behavior each POC would test, not an implementation stack.
- Let the user select **one or more** choices. Use a multi-select question tool when one is available; otherwise number the choices and ask for every choice they want to keep alive.
- Recommend the smallest useful set of choices that would expose a meaningful contrast. The recommendation may contain more than one choice.
- Treat one selected choice as a settled decision, not an axis. Record an axis only when at least two choices remain in play.
- If the user's answer introduces another direction, add it. Do not force it into the original choices.

Use this shape:

```text
Axis: <short name>
Which directions should generation 1 test? Select one or more.

A. <direction>. Tests <what this POC would let the user react to>.
B. <direction>. Tests <what this POC would let the user react to>.
C. <direction>. Tests <what this POC would let the user react to>.

Recommendation: Keep A and C alive because <specific contrast they expose>.
```

This round maps the space. It must not collapse every uncertainty into a preferred solution. Stop when each candidate axis is either resolved to one choice or has a clear set of two or more directions, then ask the user to confirm shared understanding.

### 2. Write `problem.md`

Use the template below. Everything in it comes from the interview; invent nothing, and where you took a default rather than asking, say so under **Assumptions** so it can be cheaply wrong.

### 3. Scaffold

Propose a kebab-case slug derived from the problem and confirm it with the user. It names the directory for the whole effort. Then:

```
ddiamond init --slug "<slug>" --title "<title>"
```

Write `problem.md` into the directory it prints.

### 4. Stop

Say the path, and say that `/dd-diverge` is next. Do not propose solutions, do not sketch an architecture, do not start building. The user's next reaction should be to running variants, not to your prose.

## Template

<problem-template>

# <the problem, in the user's words>

## The problem

What is wrong today, from the perspective of whoever suffers it. Concrete. A person, a moment, a cost. Not a missing feature described as a problem.

## Who has it

Who hits this, how often, and what they currently do instead.

## What good looks like

How the user will know this got better. Observable, not aspirational.

## Constraints

What genuinely cannot move: platform, data, timeline, existing systems, non-negotiable behavior. Only what the interview established as fixed.

## Assumptions

Defaults taken rather than asked about. Each is a place this could be cheaply wrong.

- <assumption> — <why it is safe enough to assume>

## Axes of disagreement

The questions the interview left genuinely open. These are what the variants exist to settle; each one is a dimension generation 1 will spread across.

### <axis name>

<the multiple-choice question used in the axis round>

- A: <selected direction still in play>. Tests <what a POC in this direction would reveal>.
- B: <selected direction still in play>. Tests <what a POC in this direction would reveal>.

## Out of scope

What this effort consciously is not about.

</problem-template>
