# Fidelity contract for a `ddiamond` variant

Binding on every variant. Read this before writing a line, and do not exceed it.

A variant exists to be **reacted to and then thrown away**. Four of them get built at once and most of them die. That inverts the usual priorities, and this file replaces them.

## The only structural target

A fresh model, reading only this variant, can locate and apply the next change request in one pass. Judge every structural choice against that and nothing else.

How you arrange the files inside the variant directory is your call. State it in one line so it can be pushed back on.

## Explicit non-goals

These are freedoms. Use them. Do not ask permission or apologise for them in comments.

- **Browser support does not matter.** The newest web platform features are fair game, including view transitions, `@starting-style`, `popover`, anchor positioning, container queries, scroll-driven animation, and whatever else this machine's browser supports. No polyfill, **no build step**.
- **No dependencies.** A variant must run by opening `index.html` from the filesystem. feel free to use libraries using script tags for complicated tasks if needed. The dashboard serves the variant from a local origin.
- **Performance does not matter.** Prefer the slow obvious approach to the fast clever one. Never optimise, and never note that something is inefficient. It is not a defect here.
- **Human readability does not matter.** Spend no effort on idiomatic style, elegance, linters, or explanatory prose for a human audience.

## Throwaway by construction

- Hardcoded or faked data. No backend, no persistence, no network.
- No auth, no error handling, no tests, no accessibility audit beyond a visible focus ring.
- State resets on reload. Nothing leaves the page.
- Expect this to be deleted, not merged.

**Gold-plating is the failure mode.** A variant that took twice as long to be twice as solid has failed, because its whole value was being cheap enough to discard.

## Required of every variant

- **`index.html` at the root of the variant directory** is the entry point. The dashboard iframes it. No `index.html` means a blank card and a wasted slot.
- **It renders something on load.** No empty state waiting for a click, no console error on first paint.
- **It argues its thesis visibly.** The thesis is the reason this variant exists; if a reviewer cannot see the argument within seconds of the card appearing, the variant has failed regardless of how well it works.
- **`prefers-reduced-motion` is handled** wherever motion carries the argument. One media query.
- **It fits a card.** The dashboard renders it in an iframe roughly 420px tall in a grid. Design for that first; it can also be opened full-window, but the card is where it gets judged.

## Deliberately not built

Every variant is briefed with a short list of what to leave out. That list is **binding**. It is what stops a spike becoming a product. Build nothing on it, and nothing that merely occurred to you along the way.

## Non-web variants

Some ideas are a CLI, a script, or a data transformation. The priorities above are unchanged. Wrap the output in an `index.html` harness page that shows the result, such as a transcript, rendered table, or before/after, so the grid stays uniform and comparable.
