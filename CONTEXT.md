# Continue from ddiamond artifacts

This repository may contain product decisions produced by a `ddiamond` exploration. Before planning or implementing a product change, look for a relevant `.scratch/<slug>/spec.md`.

## Read the handoff

When a relevant exploration exists, read:

1. `spec.md` for the product behavior to implement.
2. `manifest.yaml` for the selected variant, its lineage, and the user's verdicts.
3. The final variant's `index.html` for interactions or states that the spec cannot express as clearly.
4. `problem.md` when you need the original success criteria or constraints.

If several explorations could match the request, ask which one to use. Do not silently choose one. If the relevant exploration has no `spec.md` or no variant marked `final`, it is not ready for implementation. Tell the user what is missing instead of treating a pending prototype as the chosen product.

## Use the evidence correctly

- Treat `spec.md` as the implementation brief. Preserve decisions that it says the exploration settled unless the real codebase makes one infeasible.
- Use the final variant to understand intended behavior and feel. It is a disposable prototype, not production code. Rebuild it in the repository's existing stack and conventions rather than copying its shortcuts or structure.
- Read rejected verdicts before proposing a different interaction. They record approaches the user already tried and why they failed.
- Resolve implementation details from the real codebase. The exploration decides product behavior, not file layout, dependencies, or architecture unless the spec explicitly records such a decision.
- Ask only about gaps that neither the artifacts nor the codebase answer. Do not reopen choices the user already settled by grading variants.
- Keep `.scratch` as the design record. Do not edit the manifest, verdicts, variants, or spec while implementing unless the user asks to revise the exploration itself.
