---
name: dd-converge
description: Step 3 of the ddiamond workflow. Turn the winning exploration into a ticket-ready spec for the second diamond. Use the winning variant and the record of rejected alternatives.
argument-hint: "Optional --exploration <slug> when several are open"
disable-model-invocation: true
---

# dd-converge

Convergence ends the first diamond. The user has tried the variants and picked one. Turn that choice into a spec another agent can build from.

Output: `.scratch/<slug>/spec.md`.

## Gate

Refuse to run unless exactly one variant has `status: final`.

```
ddiamond list --json
```

If no variant is final, say so and stop. The user must choose in the dashboard. Do not choose for them in conversation.

## Process

### 1. Read the full exploration

Read these sources before writing:

- `problem.md`, for the problem, success criteria, constraints, and questions the exploration meant to answer.
- Every generation in the manifest. The history shows why the winner changed. Treat a property that survived several generations as a firm decision. A property that changed in each round may have mattered less.
- The winning variant's code. The code is disposable, but it may define a state machine, data shape, or interaction order more exactly than the manifest does.
- Every `rejected` comment. These comments record what the result must avoid.

### 2. Ask about the remaining gaps

The artifacts show what the product should be. A buildable spec may still need answers about untested edge cases, real data, or behavior that came from shortcuts in the prototype.

Invoke `/grilling` for one or two short rounds. Ask only questions the artifacts cannot answer.

Do not reopen decisions the variants settled. If a verdict comment answers a question, remove that question.

### 3. Write the spec

Use the template below. Assume the next agent has no prior context.

Do not copy the rejection history into the spec. The spec defines what to build. The manifest remains the record of discarded approaches. Point readers to it once at the top.

Avoid file paths and code snippets because they go stale. You may quote a small part of the winning variant when it defines a decision better than prose, such as a schema, type, reducer, or state machine. Include only the relevant part and identify its source. Do not include demo code.

### 4. Stop

Print the path to `spec.md`, then stop. Do not build the feature, split it into tickets, or propose architecture beyond the decisions recorded in the spec. The second diamond starts as a separate effort with fresh context.

## Template

<spec-template>

# <feature>

> Explored in `.scratch/<slug>/`. Winning variant: `<id>`. The manifest records every variant and the reasons the others were rejected. Read it before proposing another approach.

## Problem statement

Describe the problem from the affected person's perspective. Start with `problem.md`, then include what the exploration clarified.

## Solution

Describe what the user sees and does. Present the winning variant as the product to build, not as a prototype.

## User stories

Number the user stories and cover the whole feature.

1. As a <actor>, I want <capability>, so that <benefit>.

## Implementation decisions

Record the decisions established by the exploration or answered during grilling. Include module boundaries and interfaces, schema shapes, API contracts, interactions, and architecture where the evidence requires them.

Label decisions that a variant settled. They have user evidence and should only be reopened for a concrete reason.

## Testing decisions

Define tests in terms of observable behavior. Name the modules to test and the boundaries where tests provide the most coverage. Use as few test boundaries as the risk allows.

## Out of scope

List what the work excludes, including anything the exploration deliberately left untested.

## Notes

Add any other information the next agent needs.

</spec-template>
