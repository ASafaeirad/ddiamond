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

/** Every slug under `scratch` that holds a manifest, alphabetically. */
async function listExplorations(scratch: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(scratch)) {
    if (!entry.isDirectory) continue;
    if (await isFile(join(scratch, entry.name, "manifest.yaml"))) found.push(entry.name);
  }
  return found.sort();
}

/** Resolve `scratch` and the slug given explicitly, leaving ambiguity for the caller. */
async function resolveScratch(
  cwd: string,
  slugOverride?: string,
): Promise<{ scratch: string; dir?: string; slugs: string[] }> {
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
    return { scratch, dir, slugs: [slugOverride] };
  }

  const slugs = await listExplorations(scratch);
  if (slugs.length === 0) {
    throw new DdError(`No explorations found in ${scratch}. Run \`dd init\` first.`);
  }
  return { scratch, dir: slugs.length === 1 ? join(scratch, slugs[0]) : undefined, slugs };
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
  const { scratch, dir, slugs } = await resolveScratch(cwd, slugOverride);
  if (dir) return dir;
  throw new DdError(
    `Several explorations in ${scratch} (${slugs.join(", ")}). ` +
      `Name one with --exploration <slug>.`,
  );
}

/** A one-line label for the picker: the manifest title when it is worth showing. */
async function explorationLabel(scratch: string, slug: string): Promise<string> {
  try {
    const m = await readManifest(join(scratch, slug));
    const kept = m.variants.filter((v) => v.status === "kept").length;
    const final = m.variants.some((v) => v.status === "final");
    const state = final ? "final chosen" : `gen ${m.current_generation}, ${m.variants.length} variants, ${kept} kept`;
    return m.title && m.title !== slug ? `${slug} — ${m.title} (${state})` : `${slug} (${state})`;
  } catch {
    return slug;
  }
}

/**
 * Like `findExploration`, but asks when several are open instead of failing.
 * Only for commands that read rather than write history, and only on a tty —
 * a piped or scripted run still gets the explicit error.
 */
export async function pickExploration(
  cwd: string,
  slugOverride?: string,
): Promise<string> {
  const { scratch, dir, slugs } = await resolveScratch(cwd, slugOverride);
  if (dir) return dir;

  if (!Deno.stdin.isTerminal()) {
    throw new DdError(
      `Several explorations in ${scratch} (${slugs.join(", ")}). ` +
        `Name one with --exploration <slug>.`,
    );
  }

  console.log(`Several explorations in ${scratch}:\n`);
  for (const [i, slug] of slugs.entries()) {
    console.log(`  ${i + 1}. ${await explorationLabel(scratch, slug)}`);
  }
  console.log("");

  while (true) {
    const answer = prompt(`Which one? [1-${slugs.length}]`)?.trim() ?? "";
    if (answer === "") {
      throw new DdError(`No exploration chosen. Name one with --exploration <slug>.`);
    }
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= slugs.length) return join(scratch, slugs[n - 1]);
    if (slugs.includes(answer)) return join(scratch, answer);
    console.log(`Pick a number between 1 and ${slugs.length}, or type a slug.`);
  }
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
<title>${escapeHtml(m.title)} — ddiamond</title>
<style>
  :root { color-scheme: dark; --bg: #070a09; --panel: #0d1210; --panel2: #111815;
    --ink: #e7eee9; --muted: #718078; --line: #26312c; --lime: #baff68;
    --amber: #ffba52; --red: #ff655f; --cyan: #5de9dc; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; overflow: hidden; background: var(--bg); color: var(--ink);
    font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  body::after { content: ""; position: fixed; inset: 0; z-index: 90; pointer-events: none;
    background: repeating-linear-gradient(0deg, transparent 0 3px, rgba(255,255,255,.014) 3px 4px); }
  button, textarea, select { color: inherit; font: inherit; }
  button:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid var(--cyan); outline-offset: 3px; }
  .boot { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center;
    background: var(--bg); transition: opacity .3s, visibility .3s; }
  .boot.done { visibility: hidden; opacity: 0; }
  .boot-line { display: flex; gap: 10px; color: var(--lime); }
  .boot-line i { width: 7px; height: 14px; background: currentColor; animation: blink .55s steps(1) infinite; }
  .app { display: grid; grid-template-rows: 52px 1fr 38px; height: 100vh; }
  header { display: grid; grid-template-columns: 240px 1fr auto; border-bottom: 1px solid var(--line); background: #090d0b; }
  .brand, .path, .health { display: flex; align-items: center; padding: 0 16px; border-right: 1px solid var(--line); }
  .brand { color: var(--lime); font-weight: 700; letter-spacing: .09em; }
  .brand::before { content: "◆"; margin-right: 9px; font-size: 9px; animation: blink 1.4s steps(1) infinite; }
  .path { gap: 8px; color: var(--muted); }
  .path b { max-width: 32vw; overflow: hidden; color: var(--ink); text-overflow: ellipsis; white-space: nowrap; }
  .path select { border: 0; background: transparent; color: var(--lime); cursor: pointer; outline-offset: 1px; }
  .health { gap: 9px; border: 0; white-space: nowrap; }
  .health i { width: 7px; height: 7px; border-radius: 50%; background: var(--amber); box-shadow: 0 0 12px var(--amber); }
  .health.clear i { background: var(--lime); box-shadow: 0 0 12px var(--lime); }
  main { min-height: 0; display: grid; grid-template-columns: 240px minmax(420px, 1fr) 330px; }
  aside { position: relative; padding: 16px 11px; border-right: 1px solid var(--line); background: #090d0b; }
  .label { padding: 0 8px 10px; color: var(--muted); font-size: 10px; letter-spacing: .14em; }
  .queue { display: grid; gap: 5px; max-height: calc(100vh - 175px); overflow: auto; }
  .queue-item { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; gap: 8px; align-items: center;
    width: 100%; padding: 10px 8px; border: 1px solid transparent; background: transparent; text-align: left;
    cursor: pointer; transition: background .15s, border-color .15s, transform .1s; }
  .queue-item:hover { border-color: var(--line); background: var(--panel2); }
  .queue-item:active { transform: translateX(3px); }
  .queue-item.active { background: var(--lime); color: #081009; }
  .queue-item.active .q-state { color: #081009; font-weight: 700; }
  .queue-item.done:not(.active) { color: var(--muted); }
  .queue-item.done:not(.active) .q-state { color: var(--lime); }
  .queue-item.rejected:not(.active) .q-state { color: var(--red); }
  .queue-item.final:not(.active) .q-state { color: var(--amber); }
  .q-index { opacity: .65; }
  .q-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .q-state { color: var(--amber); font-size: 9px; }
  .meter { position: absolute; right: 19px; bottom: 21px; left: 19px; }
  .meter-top { display: flex; justify-content: space-between; margin-bottom: 8px; color: var(--muted); }
  .meter-track { height: 3px; overflow: hidden; background: var(--line); }
  .meter-fill { height: 100%; width: 0; background: var(--lime); transition: width .45s cubic-bezier(.16,1,.3,1); }
  .stage { min-width: 0; display: grid; grid-template-rows: 55px 1fr; background: #080c0a; }
  .stage-bar { display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid var(--line); }
  h1 { margin: 0; font-size: 12px; letter-spacing: .05em; }
  .sequence { color: var(--muted); }
  .sequence b { color: var(--lime); }
  .viewport { position: relative; min-height: 0; padding: clamp(14px,2vw,28px); overflow: hidden; }
  .candidate { display: grid; grid-template-rows: 43px 1fr; height: 100%; min-height: 440px; border: 1px solid var(--line);
    background: var(--panel); opacity: 0; transform: translateX(35px); animation: candidate-in .5s .2s cubic-bezier(.16,1,.3,1) forwards;
    transition: opacity .22s, transform .36s cubic-bezier(.4,0,.2,1), filter .22s; }
  .candidate.leaving { opacity: 0; filter: blur(3px); transform: translateX(-55px); }
  .candidate.entering { opacity: 0; transform: translateX(55px); animation: none; }
  .candidate-head { display: flex; align-items: center; justify-content: space-between; padding: 0 14px; border-bottom: 1px solid var(--line); color: var(--muted); }
  .candidate-id { color: var(--lime); }
  .candidate-tools { display: flex; gap: 14px; align-items: center; }
  .open { color: var(--muted); text-decoration: none; }
  .open:hover { color: var(--cyan); }
  .status { color: var(--amber); font-size: 9px; letter-spacing: .09em; }
  .status.kept { color: var(--lime); } .status.rejected { color: var(--red); } .status.final { color: var(--amber); }
  .preview { position: relative; min-height: 0; overflow: hidden; background: #0a0e0c; }
  .preview iframe { width: 100%; height: 100%; border: 0; background: #fff; opacity: 0; transition: opacity .35s; }
  .preview.loaded iframe { opacity: 1; }
  .loader { position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; background: #0a0e0c; transition: opacity .35s, visibility .35s; }
  .preview.loaded .loader { visibility: hidden; opacity: 0; }
  .scan { width: min(430px,70%); }
  .scan i { display: block; height: 9px; margin: 12px 0; background: linear-gradient(90deg,#15201b 20%,#2c3b34 45%,#15201b 70%);
    background-size: 220% 100%; animation: scan 1s linear infinite; }
  .scan i:first-child { width: 34%; } .scan i:nth-child(2) { height: 105px; } .scan i:last-child { width: 72%; }
  .empty { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; }
  .empty b { display: block; color: var(--lime); font-size: 18px; }
  .empty span { display: block; margin-top: 8px; color: var(--muted); }
  .review { display: grid; grid-template-rows: auto 1fr auto; border-left: 1px solid var(--line); background: var(--panel); }
  .review-head { padding: 18px; border-bottom: 1px solid var(--line); }
  .review-head span { color: var(--cyan); font-size: 10px; letter-spacing: .13em; }
  .review-head p { margin: 0; color: var(--muted); }
  .review-head .thesis-copy { margin: 12px 0 7px; color: var(--ink); font-size: 13px; line-height: 1.5; font-weight: 600;
    overflow-wrap: anywhere; }
  .notes { display: flex; flex-direction: column; padding: 18px; }
  .notes label { margin-bottom: 8px; color: var(--muted); }
  .notes textarea { flex: 1; width: 100%; min-height: 150px; padding: 12px; resize: none; border: 1px solid var(--line); background: #080c0a;
    transition: border-color .18s, box-shadow .18s; }
  .notes textarea:hover { border-color: #506057; }
  .notes textarea:focus { border-color: var(--cyan); outline: 0; box-shadow: 0 0 0 1px var(--cyan); }
  .hint { min-height: 2.8em; margin: 10px 0 0; color: var(--muted); font-size: 10px; }
  .hint.error { color: var(--red); }
  .decision { display: grid; gap: 7px; padding: 16px 18px 18px; border-top: 1px solid var(--line); }
  .action { display: flex; justify-content: space-between; padding: 10px; border: 1px solid var(--line); background: #121916; text-align: left;
    cursor: pointer; transition: background .13s, color .13s, border-color .13s, transform .08s; }
  .action:hover { border-color: var(--lime); color: var(--lime); }
  .action.reject:hover { border-color: var(--red); color: var(--red); }
  .action.final:hover { border-color: var(--amber); color: var(--amber); }
  .action:active { background: var(--lime); color: #081009; transform: scale(.97); }
  .action:disabled { cursor: wait; opacity: .45; }
  kbd { padding: 1px 5px; border: 1px solid var(--line); background: #111714; color: var(--ink); }
  .action kbd { padding: 0 4px; border-color: currentColor; }
  footer { display: flex; align-items: center; justify-content: space-between; padding: 0 14px; border-top: 1px solid var(--line); background: #090d0b; color: var(--muted); }
  footer b { color: var(--ink); }
  .keys { display: flex; gap: 16px; }
  .keys span { display: flex; align-items: center; gap: 6px; }
  .signal { position: fixed; top: 0; left: 50%; z-index: 80; display: flex; align-items: center; gap: 16px; padding: 10px 14px;
    background: var(--lime); color: #071007; transform: translate(-50%,-120%); transition: transform .32s cubic-bezier(.2,1.45,.4,1); }
  .signal.show { transform: translate(-50%,64px); }
  .signal strong { letter-spacing: .1em; } .signal span { opacity: .65; }
  dialog { width: min(480px, calc(100vw - 32px)); padding: 0; border: 1px solid var(--line); background: var(--panel); color: var(--ink);
    box-shadow: 0 24px 90px rgba(0,0,0,.72); }
  dialog::backdrop { background: rgba(3,6,5,.82); backdrop-filter: blur(4px); }
  .modal-form { display: grid; }
  .modal-head { padding: 18px; border-bottom: 1px solid var(--line); }
  .modal-head span { color: var(--cyan); font-size: 10px; letter-spacing: .13em; }
  .modal-head h2 { margin: 10px 0 0; font: 600 26px/1.05 ui-sans-serif, system-ui, sans-serif; letter-spacing: -.035em; }
  .modal-choice { color: var(--lime); }
  dialog.rejected .modal-choice { color: var(--red); }
  dialog.final .modal-choice { color: var(--amber); }
  .modal-body { padding: 18px; }
  .modal-body label { display: block; margin-bottom: 8px; color: var(--muted); }
  .modal-body textarea { width: 100%; min-height: 130px; padding: 12px; resize: vertical; border: 1px solid var(--line); background: #080c0a; }
  .modal-body textarea:focus { border-color: var(--cyan); outline: 0; box-shadow: 0 0 0 1px var(--cyan); }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 18px 18px; border-top: 1px solid var(--line); }
  .modal-button { padding: 9px 12px; border: 1px solid var(--line); background: #121916; cursor: pointer; }
  .modal-button:hover { border-color: var(--cyan); color: var(--cyan); }
  .modal-button.confirm { border-color: var(--lime); color: var(--lime); }
  dialog.rejected .modal-button.confirm { border-color: var(--red); color: var(--red); }
  dialog.final .modal-button.confirm { border-color: var(--amber); color: var(--amber); }
  @keyframes candidate-in { to { opacity: 1; transform: none; } }
  @keyframes blink { 50% { opacity: .15; } }
  @keyframes scan { to { background-position: -220% 0; } }
  @media (max-width: 1000px) {
    main { grid-template-columns: 190px 1fr; }
    .review { position: fixed; right: 0; bottom: 38px; left: 190px; z-index: 30; height: 330px;
      transform: translateY(calc(100% - 48px)); transition: transform .3s; }
    .review:focus-within, .review:hover { transform: none; }
    .review-head { height: 48px; padding: 9px 16px; }
    .review-head h2, .review-head p { display: none; }
    .notes { padding: 12px; }
    .decision { grid-template-columns: repeat(3,1fr); }
    .action { font-size: 10px; }
    .meter { display: none; }
    .viewport { padding-bottom: 58px; }
  }
  @media (max-width: 700px) {
    body { overflow: auto; }
    .app { height: auto; min-height: 100vh; }
    header { grid-template-columns: 1fr auto; }
    .path { display: none; }
    main { grid-template-columns: 1fr; }
    aside { display: none; }
    .viewport { height: 600px; }
    .review { left: 0; }
    .keys { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important;
      animation-delay: 0ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
  }
</style>
<div class="boot"><div class="boot-line"><span>OPENING SINGLE REVIEW CHANNEL</span><i></i></div></div>
<div class="app">
  <header>
    <div class="brand">DD / FOCUS</div>
    <div class="path">EXPLORATIONS / <b>${escapeHtml(m.title)}</b> / <select id="gen" aria-label="Generation"></select></div>
    <div class="health"><i></i><span id="pending"></span></div>
  </header>
  <main>
    <aside>
      <div class="label">REVIEW QUEUE</div>
      <nav class="queue" id="queue" aria-label="Review queue"></nav>
      <div class="meter"><div class="meter-top"><span>REVIEWED</span><span id="meter-count"></span></div>
        <div class="meter-track"><div class="meter-fill" id="meter-fill"></div></div>
      </div>
    </aside>
    <section class="stage">
      <div class="stage-bar"><h1>THESIS / ONE DECISION OWNS THE SCREEN</h1><span class="sequence"><b id="position">00</b> / <span id="total">00</span></span></div>
      <div class="viewport" id="viewport">
        <article class="candidate" id="candidate">
          <div class="candidate-head"><span><span class="candidate-id" id="candidate-id"></span> · <span id="lineage"></span></span>
            <span class="candidate-tools"><a class="open" id="open" target="_blank">OPEN ↗</a><span class="status" id="status"></span></span>
          </div>
          <div class="preview" id="preview"><div class="loader"><div class="scan"><i></i><i></i><i></i></div></div>
            <iframe id="frame" title="Variant preview"></iframe>
          </div>
        </article>
        <div class="empty" id="empty" hidden><div><b>QUEUE CLEAR</b><span>No candidates exist in this generation.</span></div></div>
      </div>
    </section>
    <section class="review" id="review">
      <div class="review-head"><span>ACTIVE DECISION</span><p class="thesis-copy" id="thesis"></p><p id="varies"></p></div>
      <div class="notes"><label for="verdict">REASON REQUIRED</label><textarea id="verdict" placeholder="Why does this survive or fail?"></textarea>
        <p class="hint" id="hint">This note becomes evidence for the next generation.</p></div>
      <div class="decision"><button class="action keep" data-state="kept"><span>KEEP IN PLAY</span><kbd>1</kbd></button>
        <button class="action reject" data-state="rejected"><span>SET ASIDE</span><kbd>2</kbd></button>
        <button class="action final" data-state="final"><span>CHOOSE FINAL</span><kbd>3</kbd></button></div>
    </section>
  </main>
  <footer><span>LOCAL SESSION · VERDICTS WRITE TO MANIFEST</span><div class="keys"><span><kbd>J</kbd><kbd>K</kbd> queue</span><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> verdict</span></div><b>DD 0.1</b></footer>
</div>
<div class="signal" role="status"><strong></strong><span>advancing review queue</span></div>
<dialog id="comment-modal" aria-labelledby="comment-title">
  <form class="modal-form" id="comment-form">
    <div class="modal-head"><span>VERDICT REMEMBERED</span><h2 id="comment-title">Add a reason for <strong class="modal-choice" id="modal-choice"></strong></h2></div>
    <div class="modal-body"><label for="modal-comment">REASON REQUIRED</label>
      <textarea id="modal-comment" required placeholder="Why does this survive or fail?"></textarea></div>
    <div class="modal-actions"><button class="modal-button" id="modal-cancel" type="button">CANCEL</button>
      <button class="modal-button confirm" type="submit">RECORD VERDICT</button></div>
  </form>
</dialog>
<script>
let manifest = ${JSON.stringify(m)};
const $gen = document.getElementById("gen");
const $queue = document.getElementById("queue");
const $candidate = document.getElementById("candidate");
const $preview = document.getElementById("preview");
const $frame = document.getElementById("frame");
const $hint = document.getElementById("hint");
const $signal = document.querySelector(".signal");
const $modal = document.getElementById("comment-modal");
const $modalComment = document.getElementById("modal-comment");
const buttons = [...document.querySelectorAll(".action")];
let current = 0;
let busy = false;
let signalTimer;
let pendingDecision = null;

function generations() {
  return [...new Set(manifest.variants.map(v => v.generation))].sort((a, b) => a - b);
}

function renderGenPicker() {
  const gens = generations();
  const selected = Number($gen.value) || gens.at(-1) || manifest.current_generation || 1;
  const choices = gens.length ? gens : [manifest.current_generation || 1];
  $gen.innerHTML = choices.map(g => \`<option value="\${g}">GEN-\${String(g).padStart(2,"0")}</option>\`).join("");
  $gen.value = String(choices.includes(selected) ? selected : choices.at(-1));
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function variants() {
  return manifest.variants.filter(v => v.generation === Number($gen.value));
}

function queueState(v, active) {
  if (v.status === "pending") return active ? "NOW" : "WAIT";
  return v.status === "rejected" ? "DROP" : v.status === "final" ? "FINAL" : "KEEP";
}

function renderQueue() {
  const all = variants();
  const reviewed = all.filter(v => v.status !== "pending").length;
  $queue.innerHTML = all.map((v, index) => \`<button class="queue-item \${index === current ? "active" : ""} \${v.status !== "pending" ? "done " + v.status : ""}" data-index="\${index}">
    <span class="q-index">\${String(index + 1).padStart(2,"0")}</span><span class="q-title">\${esc(v.thesis)}</span><span class="q-state">\${queueState(v, index === current)}</span></button>\`).join("");
  document.getElementById("meter-count").textContent = reviewed + " / " + all.length;
  document.getElementById("meter-fill").style.width = (all.length ? reviewed / all.length * 100 : 0) + "%";
  document.getElementById("total").textContent = String(all.length).padStart(2,"0");
}

function renderHealth() {
  const pending = manifest.variants.filter(v => v.status === "pending").length;
  const health = document.querySelector(".health");
  health.classList.toggle("clear", pending === 0);
  document.getElementById("pending").textContent = pending ? pending + " PENDING" : "ALL GRADED";
}

function paint(index, reload = true) {
  const all = variants();
  current = Math.max(0, Math.min(index, all.length - 1));
  renderQueue();
  renderHealth();
  const v = all[current];
  const empty = document.getElementById("empty");
  $candidate.hidden = !v;
  empty.hidden = Boolean(v);
  document.getElementById("review").hidden = !v;
  if (!v) { document.getElementById("position").textContent = "00"; return; }

  document.getElementById("candidate-id").textContent = v.id.toUpperCase();
  document.getElementById("lineage").textContent = v.wildcard ? "WILDCARD / ROOT" : v.parent ? "CHILD OF " + v.parent.toUpperCase() : "ROOT VARIANT";
  document.getElementById("thesis").textContent = v.thesis;
  document.getElementById("varies").textContent = v.varies;
  document.getElementById("position").textContent = String(current + 1).padStart(2,"0");
  document.getElementById("verdict").value = v.comment || "";
  const status = document.getElementById("status");
  status.textContent = v.status === "pending" ? "PENDING REVIEW" : v.status.toUpperCase();
  status.className = "status " + v.status;
  const url = "/v/" + encodeURIComponent(v.id) + "/";
  const open = document.getElementById("open");
  open.href = url;
  open.setAttribute("aria-label", "Open " + v.id + " in a new tab");
  $frame.title = v.id + " preview";
  $hint.textContent = "This note becomes evidence for the next generation.";
  $hint.classList.remove("error");
  if (reload && $frame.getAttribute("src") !== url) {
    $preview.classList.remove("loaded");
    $frame.src = url;
  }
}

function move(index) {
  const all = variants();
  if (busy || !all.length) return;
  const next = (index + all.length) % all.length;
  if (next === current) return;
  busy = true;
  $candidate.classList.add("leaving");
  setTimeout(() => {
    paint(next);
    $candidate.classList.remove("leaving");
    $candidate.classList.add("entering");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $candidate.classList.remove("entering");
      busy = false;
    }));
  }, 260);
}

async function submit(status) {
  if (busy) return;
  const all = variants();
  const v = all[current];
  if (!v) return;
  const comment = document.getElementById("verdict").value;
  $hint.textContent = "Saving verdict…";
  $hint.classList.remove("error");
  busy = true;
  buttons.forEach(button => button.disabled = true);

  const url = status === "final" ? \`/api/variants/\${v.id}/final\` : \`/api/variants/\${v.id}\`;
  const res = await fetch(url, {
    method: status === "final" ? "POST" : "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, comment }),
  });
  const body = await res.json();
  if (!res.ok) {
    $hint.textContent = body.error || "The verdict could not be saved.";
    $hint.classList.add("error");
    busy = false;
    buttons.forEach(button => button.disabled = false);
    return;
  }

  manifest = await (await fetch("/api/manifest")).json();
  const refreshed = variants();
  const savedIndex = refreshed.findIndex(item => item.id === v.id);
  current = savedIndex < 0 ? 0 : savedIndex;
  paint(current, false);
  $signal.querySelector("strong").textContent = v.id.toUpperCase() + " / " + status.toUpperCase();
  $signal.classList.add("show");
  clearTimeout(signalTimer);
  signalTimer = setTimeout(() => $signal.classList.remove("show"), 1350);
  busy = false;
  buttons.forEach(button => button.disabled = false);

  const next = refreshed.findIndex((item, index) => index > current && item.status === "pending");
  const wrap = refreshed.findIndex(item => item.status === "pending");
  if (next >= 0 || wrap >= 0) setTimeout(() => move(next >= 0 ? next : wrap), 520);
}

function requestDecision(status) {
  const comment = document.getElementById("verdict").value;
  if (comment.trim()) { submit(status); return; }
  pendingDecision = status;
  const labels = { kept: "KEEP IN PLAY", rejected: "SET ASIDE", final: "CHOOSE FINAL" };
  document.getElementById("modal-choice").textContent = labels[status];
  $modal.className = status;
  $modalComment.value = comment;
  $modal.showModal();
  $modalComment.focus();
}

$queue.addEventListener("click", e => {
  const item = e.target.closest(".queue-item");
  if (item) move(Number(item.dataset.index));
});
document.querySelector(".decision").addEventListener("click", e => {
  const button = e.target.closest(".action");
  if (button) requestDecision(button.dataset.state);
});
document.getElementById("comment-form").addEventListener("submit", e => {
  e.preventDefault();
  if (!pendingDecision || !$modalComment.value.trim()) return;
  const decision = pendingDecision;
  document.getElementById("verdict").value = $modalComment.value.trim();
  pendingDecision = null;
  $modal.close();
  submit(decision);
});
document.getElementById("modal-cancel").addEventListener("click", () => $modal.close());
$modal.addEventListener("close", () => { pendingDecision = null; });
$frame.addEventListener("load", () => $preview.classList.add("loaded"));
$gen.addEventListener("change", () => { current = 0; paint(0); });
addEventListener("keydown", e => {
  if (e.target.matches("textarea, select")) return;
  if (e.key.toLowerCase() === "j") move(current + 1);
  if (e.key.toLowerCase() === "k") move(current - 1);
  if (["1","2","3"].includes(e.key)) {
    e.preventDefault();
    buttons[Number(e.key) - 1].click();
  }
});
renderGenPicker();
paint(0);
setTimeout(() => document.querySelector(".boot").classList.add("done"), 650);
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
Override with --exploration <slug> when more than one is open; serve asks
which one instead, when it is run interactively.`;

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

  // `serve` only reads the exploration, so it can afford to ask which one.
  const dir = command === "serve"
    ? await pickExploration(Deno.cwd(), args.exploration)
    : await findExploration(Deno.cwd(), args.exploration);

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
