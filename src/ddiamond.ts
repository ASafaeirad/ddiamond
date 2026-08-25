#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net
// ddiamond - agentic double diamond

import { parse as parseYaml, stringify as stringifyYaml } from "jsr:@std/yaml";
import { parseArgs } from "jsr:@std/cli/parse-args";
import { dirname, join, normalize, resolve } from "jsr:@std/path";
import { contentType } from "jsr:@std/media-types";

// ---------------------------------------------------------------- schema

export type Status = "pending" | "kept" | "rejected" | "final";

const STATUSES: Status[] = ["pending", "kept", "rejected", "final"];
const MAX_PER_GENERATION = 6;
const DEFAULT_PORT = 7337;

export interface Variant {
  id: string;
  generation: number;
  parent: string | null;
  wildcard: boolean;
  thesis: string;
  varies: string;
  status: Status;
  comment: string;
  created: string;
}

export interface Manifest {
  slug: string;
  title: string;
  created: string;
  current_generation: number;
  variants: Variant[];
}

class DdError extends Error {}

const today = () => new Date().toISOString().slice(0, 10);
const pad2 = (n: number) => String(n).padStart(2, "0");
const genDirName = (generation: number) => `gen-${pad2(generation)}`;
const variantId = (generation: number, n: number) => `g${generation}-${pad2(n)}`;

/** A variant's path is derivable from its id alone — nothing ever has to search. */
export function variantDir(explorationDir: string, v: Variant): string {
  return join(explorationDir, genDirName(v.generation), v.id);
}

function parseVariantId(id: string): { generation: number } {
  const m = /^g(\d+)-(\d+)$/.exec(id);
  if (!m) throw new DdError(`Malformed variant id: ${id}`);
  return { generation: Number(m[1]) };
}

// ------------------------------------------------------------ resolution

async function isDir(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

/** Walk up from `from` looking for a `.scratch` directory, git-style. */
async function findScratchRoot(from: string): Promise<string | null> {
  let dir = resolve(from);
  while (true) {
    const candidate = join(dir, ".scratch");
    if (await isDir(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the exploration directory from the cwd, overridable with --exploration.
 * Ambiguity is an error rather than a guess: picking the wrong exploration
 * silently writes verdicts into the wrong history.
 */
export async function findExploration(
  cwd: string,
  slugOverride?: string,
): Promise<string> {
  const scratch = await findScratchRoot(cwd);
  if (!scratch) {
    throw new DdError(
      "No .scratch directory found in this directory or any parent. Run `dd init` first.",
    );
  }

  if (slugOverride) {
    const dir = join(scratch, slugOverride);
    if (!(await isFile(join(dir, "manifest.yaml")))) {
      throw new DdError(`No exploration named "${slugOverride}" in ${scratch}`);
    }
    return dir;
  }

  const found: string[] = [];
  for await (const entry of Deno.readDir(scratch)) {
    if (!entry.isDirectory) continue;
    if (await isFile(join(scratch, entry.name, "manifest.yaml"))) found.push(entry.name);
  }

  if (found.length === 0) {
    throw new DdError(`No explorations found in ${scratch}. Run \`dd init\` first.`);
  }
  if (found.length > 1) {
    throw new DdError(
      `Several explorations in ${scratch} (${found.join(", ")}). ` +
        `Name one with --exploration <slug>.`,
    );
  }
  return join(scratch, found[0]);
}

// ------------------------------------------------------------------- io

export async function readManifest(explorationDir: string): Promise<Manifest> {
  const raw = await Deno.readTextFile(join(explorationDir, "manifest.yaml"));
  const parsed = parseYaml(raw) as Manifest;
  parsed.variants ??= [];
  return parsed;
}

/** Write via temp file + rename so a crash mid-write can't truncate the manifest. */
export async function writeManifest(explorationDir: string, m: Manifest): Promise<void> {
  const path = join(explorationDir, "manifest.yaml");
  const tmp = `${path}.tmp`;
  await Deno.writeTextFile(tmp, stringifyYaml(m as unknown as Record<string, unknown>, { lineWidth: 100 }));
  await Deno.rename(tmp, path);
}

async function mutate<T>(
  explorationDir: string,
  fn: (m: Manifest) => T | Promise<T>,
): Promise<T> {
  const m = await readManifest(explorationDir);
  const result = await fn(m);
  await writeManifest(explorationDir, m);
  return result;
}

// ------------------------------------------------------------ mutations
// The single source of truth for every write. Both the CLI and the HTTP
// handlers go through these — nothing else may touch the manifest.

export function findVariant(m: Manifest, id: string): Variant {
  const v = m.variants.find((v) => v.id === id);
  if (!v) throw new DdError(`No variant with id "${id}"`);
  return v;
}

export function pendingVariants(m: Manifest): Variant[] {
  return m.variants.filter((v) => v.status === "pending");
}

/**
 * Allocate the next generation. Hard-blocked while anything is still pending:
 * an ungraded variant is a silent hole in the input to every future generation.
 */
export async function opNextGeneration(explorationDir: string): Promise<number> {
  return await mutate(explorationDir, (m) => {
    const pending = pendingVariants(m);
    if (pending.length > 0) {
      throw new DdError(
        `Cannot start a new generation: ${pending.length} variant(s) still pending ` +
          `(${pending.map((v) => v.id).join(", ")}). Grade them in the dashboard first.`,
      );
    }
    m.current_generation += 1;
    return m.current_generation;
  }).then(async (generation) => {
    await Deno.mkdir(join(explorationDir, genDirName(generation)), { recursive: true });
    return generation;
  });
}

export interface AddOptions {
  thesis: string;
  varies: string;
  parent?: string | null;
  wildcard?: boolean;
}

export async function opAddVariant(
  explorationDir: string,
  opts: AddOptions,
): Promise<Variant> {
  if (!opts.thesis?.trim()) throw new DdError("--thesis is required and must be non-empty.");
  if (!opts.varies?.trim()) throw new DdError("--varies is required and must be non-empty.");

  const variant = await mutate(explorationDir, (m) => {
    if (m.current_generation < 1) {
      throw new DdError("No generation started yet. Run `dd next-gen` first.");
    }
    if (opts.parent) findVariant(m, opts.parent); // existence check

    const generation = m.current_generation;
    const siblings = m.variants.filter((v) => v.generation === generation);
    if (siblings.length >= MAX_PER_GENERATION) {
      throw new DdError(
        `Generation ${generation} already has ${MAX_PER_GENERATION} variants — that is the cap.`,
      );
    }

    const v: Variant = {
      id: variantId(generation, siblings.length + 1),
      generation,
      parent: opts.parent ?? null,
      wildcard: opts.wildcard ?? false,
      thesis: opts.thesis.trim(),
      varies: opts.varies.trim(),
      status: "pending",
      comment: "",
      created: today(),
    };
    m.variants.push(v);
    return v;
  });

  await Deno.mkdir(variantDir(explorationDir, variant), { recursive: true });
  return variant;
}

/**
 * A comment is mandatory on every non-pending status: "why it survived" is
 * exactly what the next generation reads, and a blank one degrades it.
 */
export async function opSetStatus(
  explorationDir: string,
  id: string,
  status: Status,
  comment: string,
): Promise<Variant> {
  if (!STATUSES.includes(status)) {
    throw new DdError(`Unknown status "${status}". One of: ${STATUSES.join(", ")}`);
  }
  if (status === "pending") {
    throw new DdError("Cannot set a variant back to pending — that would erase a verdict.");
  }
  if (!comment?.trim()) {
    throw new DdError(`A comment is required when setting status to "${status}".`);
  }

  return await mutate(explorationDir, (m) => {
    const v = findVariant(m, id);
    if (status === "final") {
      // Exactly one final per exploration — the previous winner drops back to kept.
      for (const other of m.variants) {
        if (other.status === "final" && other.id !== id) other.status = "kept";
      }
    }
    v.status = status;
    v.comment = comment.trim();
    return v;
  });
}

// -------------------------------------------------------------- commands

async function cmdInit(args: ReturnType<typeof parseArgs>): Promise<void> {
  const slug = String(args.slug ?? "").trim();
  const title = String(args.title ?? "").trim();
  if (!slug) throw new DdError("--slug is required.");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new DdError(`--slug must be lowercase kebab-case, got "${slug}".`);
  }

  const dir = join(Deno.cwd(), ".scratch", slug);
  if (await isFile(join(dir, "manifest.yaml"))) {
    throw new DdError(`An exploration already exists at ${dir}`);
  }

  await Deno.mkdir(dir, { recursive: true });
  await writeManifest(dir, {
    slug,
    title: title || slug,
    created: today(),
    current_generation: 0,
    variants: [],
  });
  console.log(dir);
}

async function cmdNextGen(dir: string): Promise<void> {
  const generation = await opNextGeneration(dir);
  console.log(`generation ${generation} → ${join(dir, genDirName(generation))}`);
}

async function cmdAdd(dir: string, args: ReturnType<typeof parseArgs>): Promise<void> {
  const v = await opAddVariant(dir, {
    thesis: String(args.thesis ?? ""),
    varies: String(args.varies ?? ""),
    parent: args.parent ? String(args.parent) : null,
    wildcard: Boolean(args.wildcard),
  });
  console.log(`${v.id}\t${variantDir(dir, v)}`);
}

async function cmdSetStatus(dir: string, args: ReturnType<typeof parseArgs>): Promise<void> {
  const id = String(args._[1] ?? "");
  if (!id) throw new DdError("Usage: dd set-status <id> --status kept|rejected --comment \"…\"");
  const v = await opSetStatus(dir, id, String(args.status ?? "") as Status, String(args.comment ?? ""));
  console.log(`${v.id} → ${v.status}`);
}

async function cmdFinal(dir: string, args: ReturnType<typeof parseArgs>): Promise<void> {
  const id = String(args._[1] ?? "");
  if (!id) throw new DdError('Usage: dd final <id> --comment "…"');
  const v = await opSetStatus(dir, id, "final", String(args.comment ?? ""));
  console.log(`${v.id} → final`);
}

async function cmdList(dir: string, args: ReturnType<typeof parseArgs>): Promise<void> {
  const m = await readManifest(dir);
  let variants = m.variants;
  if (args.generation !== undefined) {
    variants = variants.filter((v) => v.generation === Number(args.generation));
  }
  if (args.status !== undefined) {
    variants = variants.filter((v) => v.status === String(args.status));
  }

  if (args.json) {
    console.log(JSON.stringify({ ...m, variants }, null, 2));
    return;
  }

  if (variants.length === 0) {
    console.log("(no variants)");
    return;
  }
  const marks: Record<Status, string> = {
    pending: "· pending ",
    kept: "+ kept    ",
    rejected: "- rejected",
    final: "★ FINAL   ",
  };
  for (const v of variants) {
    const lineage = v.wildcard ? "wildcard" : v.parent ? `← ${v.parent}` : "root";
    console.log(`${v.id}  ${marks[v.status]}  ${lineage.padEnd(10)}  ${v.thesis}`);
    if (v.comment) console.log(`${" ".repeat(8)}“${v.comment.replaceAll("\n", " ")}”`);
  }
}

// --------------------------------------------------------------- server

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function serveVariantFile(dir: string, id: string, rest: string): Promise<Response> {
  const m = await readManifest(dir);
  const v = findVariant(m, id);
  const base = variantDir(dir, v);
  const relative = normalize(rest === "" || rest === "/" ? "index.html" : rest);
  if (relative.startsWith("..")) return new Response("Nope", { status: 403 });

  const path = join(base, relative);
  if (!resolve(path).startsWith(resolve(base))) return new Response("Nope", { status: 403 });

  try {
    const file = await Deno.readFile(path);
    const ext = path.slice(path.lastIndexOf("."));
    return new Response(file, {
      headers: { "content-type": contentType(ext) ?? "application/octet-stream" },
    });
  } catch {
    return new Response(
      `<!doctype html><meta charset=utf-8><body style="font:14px/1.6 system-ui;padding:2rem;color:#b91c1c">` +
        `<strong>${id}</strong> has no <code>${relative}</code> yet.`,
      { status: 404, headers: { "content-type": "text/html" } },
    );
  }
}

async function handle(dir: string, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  try {
    if (path === "/" ) {
      const m = await readManifest(dir);
      return new Response(dashboardHtml(m), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (path === "/api/manifest" && req.method === "GET") {
      return json(await readManifest(dir));
    }

    const patch = /^\/api\/variants\/([^/]+)$/.exec(path);
    if (patch && req.method === "PATCH") {
      const body = await req.json();
      const v = await opSetStatus(dir, patch[1], body.status, body.comment ?? "");
      return json(v);
    }

    const final = /^\/api\/variants\/([^/]+)\/final$/.exec(path);
    if (final && req.method === "POST") {
      const body = await req.json();
      const v = await opSetStatus(dir, final[1], "final", body.comment ?? "");
      return json(v);
    }

    const variant = /^\/v\/([^/]+)(\/.*)?$/.exec(path);
    if (variant) return await serveVariantFile(dir, variant[1], variant[2] ?? "");

    return new Response("Not found", { status: 404 });
  } catch (err) {
    if (err instanceof DdError) return json({ error: err.message }, 400);
    return json({ error: String(err) }, 500);
  }
}

async function cmdServe(dir: string, args: ReturnType<typeof parseArgs>): Promise<void> {
  const requested = Number(args.port ?? DEFAULT_PORT);
  for (let port = requested; port < requested + 20; port++) {
    try {
      const server = Deno.serve(
        { port, onListen: () => console.log(`dd dashboard → http://localhost:${port}`) },
        (req) => handle(dir, req),
      );
      await server.finished;
      return;
    } catch (err) {
      if (err instanceof Deno.errors.AddrInUse) continue;
      throw err;
    }
  }
  throw new DdError(`No free port in ${requested}–${requested + 19}.`);
}

// ------------------------------------------------------------ dashboard

function dashboardHtml(m: Manifest): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(m.title)} — dd</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f6f7; --panel: #fff; --ink: #17181c; --muted: #6b7280;
    --line: #e2e3e7; --accent: #2563eb;
    --kept: #15803d; --rejected: #b91c1c; --final: #a16207;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #111214; --panel: #191b1f; --ink: #e9eaee; --muted: #9aa1ac;
      --line: #2c2f36; --accent: #60a5fa;
      --kept: #4ade80; --rejected: #f87171; --final: #fbbf24;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
         font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
  header { position: sticky; top: 0; z-index: 5; display: flex; gap: 1rem;
           align-items: center; flex-wrap: wrap;
           padding: .75rem 1.25rem; background: var(--panel);
           border-bottom: 1px solid var(--line); }
  h1 { font-size: 1rem; margin: 0 1rem 0 0; font-weight: 650; }
  select, button, textarea { font: inherit; color: inherit; }
  select { background: var(--bg); border: 1px solid var(--line);
           border-radius: 6px; padding: .3rem .5rem; }
  label.toggle { display: flex; align-items: center; gap: .4rem; color: var(--muted); }
  .grid { display: grid; gap: 1rem; padding: 1.25rem;
          grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); }
  .card { background: var(--panel); border: 1px solid var(--line);
          border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
  .card.kept { border-color: var(--kept); }
  .card.rejected { border-color: var(--rejected); opacity: .72; }
  .card.final { border-color: var(--final); box-shadow: 0 0 0 2px color-mix(in srgb, var(--final) 30%, transparent); }
  .card-head { padding: .7rem .9rem; border-bottom: 1px solid var(--line); }
  .id { font-family: ui-monospace, monospace; font-weight: 700; }
  .badge { font-size: .72rem; text-transform: uppercase; letter-spacing: .05em;
           padding: .1rem .45rem; border-radius: 99px; border: 1px solid currentColor; }
  .badge.kept { color: var(--kept); } .badge.rejected { color: var(--rejected); }
  .badge.final { color: var(--final); } .badge.pending { color: var(--muted); }
  .thesis { margin: .4rem 0 0; }
  .meta { color: var(--muted); font-size: .82rem; margin-top: .25rem; }
  iframe { width: 100%; height: 420px; border: 0; border-bottom: 1px solid var(--line);
           background: #fff; }
  .verdict { padding: .7rem .9rem; display: flex; flex-direction: column; gap: .5rem; }
  textarea { width: 100%; min-height: 3.2em; resize: vertical; padding: .45rem .55rem;
             background: var(--bg); border: 1px solid var(--line); border-radius: 6px; }
  .actions { display: flex; gap: .5rem; flex-wrap: wrap; }
  button { cursor: pointer; border: 1px solid var(--line); background: var(--bg);
           border-radius: 6px; padding: .35rem .7rem; }
  button:hover { border-color: var(--accent); }
  button.keep:hover { border-color: var(--kept); color: var(--kept); }
  button.reject:hover { border-color: var(--rejected); color: var(--rejected); }
  button.final:hover { border-color: var(--final); color: var(--final); }
  .err { color: var(--rejected); font-size: .85rem; min-height: 1.2em; }
  .empty { padding: 3rem 1.25rem; color: var(--muted); }
</style>
<header>
  <h1>${escapeHtml(m.title)}</h1>
  <label>Generation <select id="gen"></select></label>
  <label class="toggle"><input type="checkbox" id="showRejected"> show rejected</label>
  <span id="summary" class="meta"></span>
</header>
<div class="grid" id="grid"></div>
<script>
let manifest = ${JSON.stringify(m)};
const $grid = document.getElementById("grid");
const $gen = document.getElementById("gen");
const $showRejected = document.getElementById("showRejected");
const $summary = document.getElementById("summary");

function generations() {
  return [...new Set(manifest.variants.map(v => v.generation))].sort((a, b) => a - b);
}

function renderGenPicker() {
  const gens = generations();
  const current = Number($gen.value) || gens.at(-1) || 1;
  $gen.innerHTML = gens.map(g => \`<option value="\${g}">\${g}</option>\`).join("");
  $gen.value = String(gens.includes(current) ? current : gens.at(-1));
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function render() {
  const gen = Number($gen.value);
  const all = manifest.variants.filter(v => v.generation === gen);
  const shown = $showRejected.checked ? all : all.filter(v => v.status !== "rejected");

  const pending = manifest.variants.filter(v => v.status === "pending").length;
  $summary.textContent = pending
    ? pending + " pending across all generations — next generation is blocked"
    : "all graded";

  if (!shown.length) {
    $grid.innerHTML = '<p class="empty">Nothing to show in this generation.</p>';
    return;
  }

  $grid.innerHTML = shown.map(v => \`
    <article class="card \${v.status}" data-id="\${v.id}">
      <div class="card-head">
        <span class="id">\${v.id}</span>
        <span class="badge \${v.status}">\${v.status}</span>
        \${v.wildcard ? '<span class="badge">wildcard</span>' : ""}
        <p class="thesis">\${esc(v.thesis)}</p>
        <p class="meta">\${v.parent ? "child of " + v.parent + " — " : ""}\${esc(v.varies)}</p>
      </div>
      <iframe src="/v/\${v.id}/" loading="lazy" title="\${v.id}"></iframe>
      <div class="verdict">
        <textarea placeholder="Why does it survive, or why does it die? Required.">\${esc(v.comment)}</textarea>
        <div class="actions">
          <button class="keep">Keep</button>
          <button class="reject">Reject</button>
          <button class="final">Select as final</button>
          <a href="/v/\${v.id}/" target="_blank" style="margin-left:auto;align-self:center;color:var(--muted)">open ↗</a>
        </div>
        <p class="err"></p>
      </div>
    </article>\`).join("");
}

async function submit(card, status) {
  const id = card.dataset.id;
  const comment = card.querySelector("textarea").value;
  const err = card.querySelector(".err");
  err.textContent = "";

  const url = status === "final" ? \`/api/variants/\${id}/final\` : \`/api/variants/\${id}\`;
  const res = await fetch(url, {
    method: status === "final" ? "POST" : "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, comment }),
  });
  const body = await res.json();
  if (!res.ok) { err.textContent = body.error; return; }

  manifest = await (await fetch("/api/manifest")).json();
  render();
}

$grid.addEventListener("click", e => {
  const button = e.target.closest("button");
  if (!button) return;
  const status = button.classList.contains("keep") ? "kept"
    : button.classList.contains("reject") ? "rejected"
    : button.classList.contains("final") ? "final" : null;
  if (status) submit(button.closest(".card"), status);
});

$gen.addEventListener("change", render);
$showRejected.addEventListener("change", render);
renderGenPicker();
render();
</script>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

// ------------------------------------------------------------------ main

const HELP = `ddiamond - agentic double diamond workflow

  ddiamond init --slug <slug> [--title <title>]     scaffold .scratch/<slug>/
  ddiamond next-gen                                 start the next generation (blocked while pending)
  ddiamond add --thesis <t> --varies <v> [--parent <id>] [--wildcard]
  ddiamond set-status <id> --status kept|rejected --comment "…"
  ddiamond final <id> --comment "…"
  ddiamond list [--json] [--generation N] [--status S]
  ddiamond serve [--port N]                         dashboard, default port ${DEFAULT_PORT}

The exploration is resolved by walking up from the cwd to a .scratch directory.
Override with --exploration <slug> when more than one is open.`;

async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    string: ["slug", "title", "thesis", "varies", "parent", "status", "comment", "exploration", "port", "generation"],
    boolean: ["wildcard", "json", "help"],
  });
  const command = String(args._[0] ?? "");

  if (!command || args.help || command === "help") {
    console.log(HELP);
    return;
  }

  if (command === "init") {
    await cmdInit(args);
    return;
  }

  const dir = await findExploration(Deno.cwd(), args.exploration);

  switch (command) {
    case "next-gen": await cmdNextGen(dir); break;
    case "add": await cmdAdd(dir, args); break;
    case "set-status": await cmdSetStatus(dir, args); break;
    case "final": await cmdFinal(dir, args); break;
    case "list": await cmdList(dir, args); break;
    case "serve": await cmdServe(dir, args); break;
    default: throw new DdError(`Unknown command "${command}". Run \`ddiamond --help\`.`);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    console.error(err instanceof DdError ? `ddiamond: ${err.message}` : err);
    Deno.exit(1);
  }
}
