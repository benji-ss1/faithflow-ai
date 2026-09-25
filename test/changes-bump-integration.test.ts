/**
 * `npm run changes:bump` — integration test against a REAL git repo.
 *
 * Run: npx tsx test/changes-bump-integration.test.ts
 *
 * The pure helpers are covered by test/changelog-version-collision.test.ts.
 * This covers the part that only exists in the script: WHICH notes it decides
 * are unreleased. That decision carries the invariant the whole file exists to
 * protect — a note that has already shipped must never be renumbered, because
 * an operator who dismissed What's New for that version would never see it
 * again — and a dogfood run showed the first version got it wrong.
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const SCRIPT = join(SCRIPTS, "bump-changes.mjs");

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

/** A throwaway repo with an `origin` remote, so merge-base and tip both exist. */
function makeRepo() {
  const upstream = mkdtempSync(join(tmpdir(), "pf-up-"));
  const clone = mkdtempSync(join(tmpdir(), "pf-cl-"));
  const g = (dir: string) => (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const U = g(upstream);
  U("init", "-q", "-b", "main");
  U("config", "user.email", "t@t"); U("config", "user.name", "t");
  mkdirSync(join(upstream, "changes"), { recursive: true });
  mkdirSync(join(upstream, "src", "lib"), { recursive: true });
  writeFileSync(join(upstream, "src/lib/changelog.ts"), "const CHANGELOG_HISTORY: ChangelogEntry[] = [];\n");
  writeFileSync(join(upstream, "package.json"), JSON.stringify({ version: "0.1.1" }));
  const note = (dir: string, slug: string, version: string) =>
    writeFileSync(join(dir, "changes", `${slug}.md`),
      `---\nheadline: ${slug}\naudience: operator\nversion: ${version}\ndate: 2026-09-25\nhighlights:\n  - x\n---\n`);
  note(upstream, "old", "0.1.500");
  U("add", "-A"); U("commit", "-q", "-m", "base");

  execFileSync("git", ["clone", "-q", upstream, clone], { stdio: "ignore" });
  const C = g(clone);
  C("config", "user.email", "t@t"); C("config", "user.name", "t");
  C("checkout", "-q", "-b", "feature");
  return { upstream, clone, U, C, note };
}

const run = (cwd: string, ...args: string[]) =>
  execFileSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8", env: { ...process.env, PF_ROOT: cwd } });
const versionOf = (repo: string, slug: string) =>
  /^version:\s*(.+)$/m.exec(readFileSync(join(repo, "changes", `${slug}.md`), "utf8"))![1].trim();

console.log("\nchanges:bump — integration\n");

check("THE INVARIANT: a note shipped on the base TIP is never renumbered", () => {
  const { upstream, clone, U, C, note } = makeRepo();
  try {
    // My branch writes a note...
    note(clone, "mine", "0.1.501");
    C("add", "-A"); C("commit", "-q", "-m", "mine");
    // ...meanwhile main ships two of its own, ABOVE mine.
    note(upstream, "theirs-a", "0.1.501");
    note(upstream, "theirs-b", "0.1.502");
    U("add", "-A"); U("commit", "-q", "-m", "theirs");
    C("fetch", "-q", "origin");
    // Merging main in is what made the first version misbehave: main's shipped
    // notes are absent from the MERGE BASE though present in the tree.
    C("merge", "-q", "origin/main", "-m", "merge");

    run(clone, "--dry-run"); // must not write
    assert.strictEqual(versionOf(clone, "theirs-a"), "0.1.501", "dry-run wrote a file");

    run(clone);
    assert.strictEqual(versionOf(clone, "theirs-a"), "0.1.501", "RENUMBERED A SHIPPED NOTE");
    assert.strictEqual(versionOf(clone, "theirs-b"), "0.1.502", "RENUMBERED A SHIPPED NOTE");
    assert.strictEqual(versionOf(clone, "mine"), "0.1.503", "my own note was not lifted above main");
  } finally {
    rmSync(upstream, { recursive: true, force: true });
    rmSync(clone, { recursive: true, force: true });
  }
});

check("a branch that never merged main is still lifted above the TIP", () => {
  const { upstream, clone, U, C, note } = makeRepo();
  try {
    note(clone, "mine", "0.1.501");
    C("add", "-A"); C("commit", "-q", "-m", "mine");
    note(upstream, "theirs", "0.1.505");
    U("add", "-A"); U("commit", "-q", "-m", "theirs");
    C("fetch", "-q", "origin");            // no merge — merge base is stale
    run(clone);
    assert.strictEqual(versionOf(clone, "mine"), "0.1.506", "floor ignored the base tip");
  } finally {
    rmSync(upstream, { recursive: true, force: true });
    rmSync(clone, { recursive: true, force: true });
  }
});

check("a note already above the tip is left alone (no version churn)", () => {
  const { upstream, clone, C, note } = makeRepo();
  try {
    note(clone, "mine", "0.1.900");
    C("add", "-A"); C("commit", "-q", "-m", "mine");
    C("fetch", "-q", "origin");
    const out = run(clone);
    assert.match(out, /nothing to do/i);
    assert.strictEqual(versionOf(clone, "mine"), "0.1.900");
  } finally {
    rmSync(upstream, { recursive: true, force: true });
    rmSync(clone, { recursive: true, force: true });
  }
});

check("deliberately grouped notes are moved TOGETHER, not split apart", () => {
  const { upstream, clone, C, note } = makeRepo();
  try {
    note(clone, "obs-a", "0.1.400");
    note(clone, "obs-b", "0.1.400");   // same version on purpose — one card
    C("add", "-A"); C("commit", "-q", "-m", "grouped");
    C("fetch", "-q", "origin");
    run(clone);
    assert.strictEqual(versionOf(clone, "obs-a"), versionOf(clone, "obs-b"),
      "splitting a grouped release surfaces a headline that was suppressed");
  } finally {
    rmSync(upstream, { recursive: true, force: true });
    rmSync(clone, { recursive: true, force: true });
  }
});

// --- THE GATE: the half that actually stops a collision shipping ------------
//
// These exist because the gate fix was silently lost once: a `git reset --hard`
// dropped the edit while the commit message still claimed it. Reading the code
// would not have caught that. Running it does.

/** Run check-changes.mjs in `cwd`; returns { ok, out }. */
function runGate(cwd: string) {
  try {
    // --strict: the gate only EXITS non-zero under CI=true or --strict (it
    // warns locally by design). Without this the test would pass a rejected
    // note, which is exactly the blind spot being closed here.
    const out = execFileSync("node", [join(SCRIPTS, "check-changes.mjs"), "--strict"], {
      cwd, encoding: "utf8", env: { ...process.env, CHANGES_BASE: "origin/main" },
    });
    return { ok: true, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

/** main ships `shipped`; our branch holds `mine` and never merges main. */
function gateScenario(mine: string, shipped: string, mergeMainIn: boolean) {
  const { upstream, clone, U, C, note } = makeRepo();
  try {
    for (const f of ["check-changes.mjs", "changelog-lib.mjs"]) {
      mkdirSync(join(clone, "scripts"), { recursive: true });
      writeFileSync(join(clone, "scripts", f), readFileSync(join(SCRIPTS, f), "utf8"));
    }
    note(clone, "mine", mine);
    mkdirSync(join(clone, "src"), { recursive: true });
    writeFileSync(join(clone, "src", "x.ts"), "export const x = 1;");
    C("add", "-A"); C("commit", "-q", "-m", "mine");

    note(upstream, "theirs", shipped);
    U("add", "-A"); U("commit", "-q", "-m", "theirs");
    C("fetch", "-q", "origin");
    if (mergeMainIn) C("merge", "-q", "origin/main", "-m", "merge");

    return runGate(clone);
  } finally {
    rmSync(upstream, { recursive: true, force: true });
    rmSync(clone, { recursive: true, force: true });
  }
}

check("GATE scenario (a): a number main already shipped is REJECTED", () => {
  // Two branches minted 0.1.501; main shipped it first. The merge base still
  // predates it, so a merge-base-only gate would pass this and the note would
  // vanish under the winner's headline.
  const r = gateScenario("0.1.501", "0.1.501", false);
  assert.strictEqual(r.ok, false, `gate PASSED a colliding note:\n${r.out}`);
  assert.match(r.out, /must be above 0\.1\.501/);
  assert.match(r.out, /changes:bump/, "the error must name the fix");
});

check("GATE scenario (b): main advanced, branch never merged main — REJECTED", () => {
  const r = gateScenario("0.1.501", "0.1.502", false);
  assert.strictEqual(r.ok, false, `gate PASSED a stale note:\n${r.out}`);
  assert.match(r.out, /must be above 0\.1\.502/);
});

check("GATE scenario (c): merged main in — still REJECTED", () => {
  const r = gateScenario("0.1.501", "0.1.502", true);
  assert.strictEqual(r.ok, false, `gate PASSED after merging main:\n${r.out}`);
});

check("GATE: a note genuinely above the tip PASSES (the gate is not just strict)", () => {
  const r = gateScenario("0.1.999", "0.1.502", false);
  assert.strictEqual(r.ok, true, `gate rejected a valid note:\n${r.out}`);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
