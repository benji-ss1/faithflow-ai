/**
 * New-song dialog (plan A.6) + Themes picker popover (A.7) + transparent
 * defaults (round 3 items 2-5). DOM via jsdom; the create sequence via
 * injected fake server actions.
 * Run: npx tsx test/new-song-dialog-dom.test.tsx
 */
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import Module from "node:module";

const load = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...a: unknown[]) => unknown })._load = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return {};
  return load.call(this, req, ...rest);
} as never;

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "Node", "localStorage", "FormData", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement"] as const) {
  const v = (dom.window as unknown as Record<string, unknown>)[k];
  if (v !== undefined) Object.defineProperty(globalThis, k, { value: v, configurable: true });
}
class RO { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, "ResizeObserver", { value: RO, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number, configurable: true });
Object.defineProperty(globalThis, "cancelAnimationFrame", { value: (id: number) => clearTimeout(id), configurable: true });
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as unknown as { React: typeof React }).React = React;

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).stack}`); fail++; }
}

const T_RED = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Red", config: { bgType: "solid", bgColor: "#aa0000" } };
const T_BLUE = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Blue", config: { bgType: "solid", bgColor: "#0000aa" }, isDefault: true };
const T_CLEAR = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Clear", config: {} };
const THEMES = [T_RED, T_BLUE, T_CLEAR];

let createRoot: typeof import("react-dom/client").createRoot;
function mount(el: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(el); });
  return { host, root, unmount: () => act(() => { root.unmount(); host.remove(); }) };
}
function click(el: Element | null) { assert.ok(el, "element exists"); act(() => { (el as HTMLElement).dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); }
function key(el: Element, k: string) { act(() => { el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true })); }); }
function setValue(el: HTMLInputElement | HTMLSelectElement, v: string) {
  const proto = el instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => { setter.call(el, v); el.dispatchEvent(new window.Event(el instanceof window.HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}

async function main() {
  // Loaded AFTER the jsdom globals exist, so react-dom detects native `input` events.
  ({ createRoot } = await import("react-dom/client"));
  const M = await import("../src/components/operator/pro/center/NewSongDialog");
  const O = await import("../src/lib/new-song-options");
  console.log("new-song dialog — DOM");

  const data = { themes: THEMES, libraries: [{ id: "lib-1", name: "Hymns" }], plans: [{ id: "plan-1", title: "Sunday", scheduledFor: "2026-09-27" }], recentIds: [T_CLEAR.id, "gone-id", T_RED.id, T_BLUE.id] };

  await check("default: filename focused, theme = transparent checkerboard, 1920x1080, Default library, No Playlist", () => {
    let got: unknown = null;
    const m = mount(<M.NewSongForm data={data} onSubmit={(v) => { got = v; }} onCancel={() => {}} />);
    const input = m.host.querySelector("#new-song-filename") as HTMLInputElement;
    assert.equal(document.activeElement, input, "filename focused");
    assert.equal(m.host.querySelector("[data-new-song-theme-thumb]")!.getAttribute("data-new-song-theme-thumb"), "transparent");
    assert.ok(m.host.querySelector("[data-transparent-thumb]"), "checkerboard thumb");
    assert.equal((m.host.querySelector("#new-song-size") as HTMLSelectElement).value, "1920x1080");
    assert.equal((m.host.querySelector("#new-song-library") as HTMLSelectElement).value, "default");
    assert.equal((m.host.querySelector("#new-song-playlist") as HTMLSelectElement).value, "none");
    assert.ok((m.host.querySelector("[data-new-song-submit]") as HTMLButtonElement).disabled, "New disabled without a name");
    setValue(input, "Way Maker");
    act(() => { (m.host.querySelector("form") as HTMLFormElement).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
    assert.deepEqual(got, { title: "Way Maker", artist: "", theme: "none", size: "1920x1080", libraryId: "default", planId: "none", seedFirstSlide: true });
    m.unmount();
  });

  await check("picker: Recents (last 3 known, most-recent first) above the rule; grid = None + Current default + all themes", () => {
    const m = mount(<M.NewSongForm data={data} onSubmit={() => {}} onCancel={() => {}} />);
    click(m.host.querySelector('[aria-label="Choose theme"]'));
    const picker = m.host.querySelector("[data-new-song-theme-picker]")!;
    assert.ok(picker, "popover open");
    assert.equal(picker.getAttribute("aria-label"), "Themes");
    assert.ok(picker.querySelector('[aria-label="Manage themes"]'), "image icon button");
    const recents = [...picker.querySelectorAll("[data-recents] [data-theme-choice]")].map((b) => b.getAttribute("data-theme-choice"));
    assert.deepEqual(recents, [T_CLEAR.id, T_RED.id, T_BLUE.id], "recents order, unknown ids skipped, capped at 3");
    assert.ok(picker.querySelector("hr"), "divider");
    const all = [...picker.querySelectorAll("[data-all-themes] [data-theme-choice]")].map((b) => b.getAttribute("data-theme-choice"));
    assert.deepEqual(all, ["none", "current-default", T_RED.id, T_BLUE.id, T_CLEAR.id]);
    assert.equal(picker.querySelectorAll("[data-all-themes] [data-theme-thumb]").length, 4, "live thumbnails for real themes");
    const selected = picker.querySelector('[data-all-themes] [data-theme-choice="none"]')!;
    assert.equal(selected.getAttribute("aria-pressed"), "true", "current selection marked");
    assert.match(selected.className, /ring-\[3px\]/, "thick outline on selected");
    m.unmount();
  });

  await check("picker: click selects + closes + updates the thumbnail; theme persisted in submit", () => {
    let got: { theme?: string } | null = null;
    const m = mount(<M.NewSongForm data={data} onSubmit={(v) => { got = v; }} onCancel={() => {}} />);
    click(m.host.querySelector('[aria-label="Choose theme"]'));
    click(m.host.querySelector(`[data-all-themes] [data-theme-choice="${T_RED.id}"]`));
    assert.equal(m.host.querySelector("[data-new-song-theme-picker]"), null, "closed");
    assert.equal(m.host.querySelector("[data-new-song-theme-thumb]")!.getAttribute("data-new-song-theme-thumb"), T_RED.id);
    setValue(m.host.querySelector("#new-song-filename") as HTMLInputElement, "Song");
    act(() => { (m.host.querySelector("form") as HTMLFormElement).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(got!.theme, T_RED.id);
    m.unmount();
  });

  await check("picker keyboard: arrows move focus, Enter selects, Esc closes without change", () => {
    const m = mount(<M.NewSongForm data={data} onSubmit={() => {}} onCancel={() => {}} />);
    click(m.host.querySelector('[aria-label="Choose theme"]'));
    let picker = m.host.querySelector("[data-new-song-theme-picker]")!;
    assert.equal((document.activeElement as HTMLElement).getAttribute("data-theme-choice"), "none", "focus starts on the selection");
    key(picker, "ArrowRight");
    assert.equal((document.activeElement as HTMLElement).getAttribute("data-theme-choice"), "current-default");
    key(picker, "ArrowRight");
    key(picker, "Enter");
    assert.equal(m.host.querySelector("[data-new-song-theme-picker]"), null);
    assert.equal(m.host.querySelector("[data-new-song-theme-thumb]")!.getAttribute("data-new-song-theme-thumb"), T_RED.id);
    click(m.host.querySelector('[aria-label="Choose theme"]'));
    picker = m.host.querySelector("[data-new-song-theme-picker]")!;
    key(picker, "ArrowDown");
    key(picker, "Escape");
    assert.equal(m.host.querySelector("[data-new-song-theme-picker]"), null, "Esc closes");
    assert.equal(m.host.querySelector("[data-new-song-theme-thumb]")!.getAttribute("data-new-song-theme-thumb"), T_RED.id, "unchanged");
    m.unmount();
  });

  function fakeDeps() {
    const calls: string[] = [];
    const fds: FormData[] = [];
    return {
      calls, fds,
      deps: {
        createSong: async (fd: FormData) => { fds.push(fd); calls.push("createSong"); return { ok: true, data: { id: "song-1" } }; },
        createSongSlide: async (id: string, _a?: number, init?: { objects: unknown[]; lyrics: string }) => { calls.push(`slide:${id}:${JSON.stringify(init)}`); return { ok: true }; },
        applyThemeToSong: async (t: string, s: string) => { calls.push(`apply:${t}:${s}`); return { ok: true }; },
        addServiceItem: async (p: string, type: string, title: string, payload: Record<string, unknown>) => { calls.push(`plan:${p}:${type}:${title}:${JSON.stringify(payload)}`); return { ok: true }; },
        pushThemeRecent: (id: string) => { calls.push(`recent:${id}`); },
      },
    };
  }
  const base = { title: " Way Maker ", artist: "", theme: "none", size: "1920x1080" as const, libraryId: "default", planId: "none", seedFirstSlide: true };

  await check("create with None: transparent — no theme sent, no applyThemeToSong, blank slide with no objects", async () => {
    const f = fakeDeps();
    const r = await M.performCreateSong(base, THEMES, f.deps);
    assert.equal(r.ok, true);
    assert.equal(f.fds[0].get("themeId"), null);
    assert.equal(f.fds[0].get("libraryId"), null);
    assert.equal(f.fds[0].get("title"), "Way Maker");
    assert.deepEqual(f.calls, ["createSong", 'slide:song-1:{"objects":[],"lyrics":""}'], "exactly the previous Add-song sequence");
  });
  await check("create with a theme: validated on create + persisted via applyThemeToSong + recents", async () => {
    const f = fakeDeps();
    const r = await M.performCreateSong({ ...base, theme: T_RED.id, libraryId: "lib-1", planId: "plan-1" }, THEMES, f.deps);
    assert.equal(r.ok, true);
    assert.equal(f.fds[0].get("themeId"), T_RED.id, "server gets the id to validate before insert");
    assert.equal(f.fds[0].get("libraryId"), "lib-1");
    assert.deepEqual(f.calls.slice(1), ['slide:song-1:{"objects":[],"lyrics":""}', `apply:${T_RED.id}:song-1`, `recent:${T_RED.id}`, 'plan:plan-1:song:Way Maker:{"songId":"song-1"}']);
  });
  await check("Current default resolves to the church default theme; none set ⇒ transparent", async () => {
    assert.equal(M.resolveThemeChoice("current-default", THEMES), T_BLUE.id);
    assert.equal(M.resolveThemeChoice("current-default", [T_RED]), null);
    assert.equal(M.resolveThemeChoice("unknown-id", THEMES), null, "stale id never sent");
  });
  await check("server refusal (e.g. foreign theme) creates nothing further", async () => {
    const f = fakeDeps();
    f.deps.createSong = async () => ({ ok: false, error: "Theme not found" }) as never;
    const r = await M.performCreateSong({ ...base, theme: T_RED.id, planId: "plan-1" }, THEMES, f.deps);
    assert.deepEqual(r, { ok: false, error: "Theme not found" });
    assert.deepEqual(f.calls, []);
  });
  await check("theme/playlist failure after create ⇒ warnings, song kept", async () => {
    const f = fakeDeps();
    f.deps.applyThemeToSong = async () => ({ ok: false, error: "nope" });
    f.deps.addServiceItem = async () => ({ ok: false, error: "Not found" });
    const r = await M.performCreateSong({ ...base, theme: T_RED.id, planId: "plan-1" }, THEMES, f.deps);
    assert.ok(r.ok && r.warnings.length === 2);
  });
  await check("recents helpers", () => {
    assert.deepEqual(O.nextRecents(["a", "b", "c"], "b"), ["b", "a", "c"]);
    assert.deepEqual(O.pickRecentThemes(["x", "b", "a", "b"], [{ id: "a" }, { id: "b" }]).map((t) => t.id), ["b", "a"]);
  });

  await check("SongsBrowser uses the new dialog; old dead localStorage template key gone", () => {
    const s = readFileSync("src/components/operator/pro/center/SongsBrowser.tsx", "utf8");
    assert.match(s, /<NewSongDialog/);
    assert.doesNotMatch(s, /presentflow\.song\.template\./);
    assert.doesNotMatch(s, /<option value="brand">Brand<\/option>/);
    assert.match(s, /Apply theme/, "apply-theme on any library song (incl. imported)");
  });

  await check("imports stay transparent: bulk import writes lyrics only (no bg, no theme)", () => {
    const s = readFileSync("src/lib/song-bulk-insert.ts", "utf8");
    assert.match(s, /slideRows: \{ songId: string; order: number; lyrics: string \}\[\]/);
    assert.doesNotMatch(s, /objectsJson|bgColor|appliedThemeId/);
  });

  await check("ThemedSlideCard checkerboard: flag OFF ⇒ markup unchanged (no checkerboard)", async () => {
    const { ThemedSlideCard } = await import("../src/components/operator/pro/center/ThemedSlideCard");
    const html = renderToStaticMarkup(<ThemedSlideCard slide={{ kind: "text", text: "x" }} appearance={undefined} />);
    assert.doesNotMatch(html, /data-slide-checkerboard/);
  });
  await check("ThemedSlideCard checkerboard: flag ON ⇒ checkerboard under text slides only", async () => {
    const { ThemedSlideCard } = await import("../src/components/operator/pro/center/ThemedSlideCard");
    const flag = await import("../src/lib/layer-order-v3");
    flag.setLayerOrderV3Flag(true);
    try {
      const m = mount(<ThemedSlideCard slide={{ kind: "text", text: "x" }} appearance={undefined} />);
      assert.ok(m.host.querySelector("[data-slide-checkerboard]"), "text slide shows checkerboard");
      m.unmount();
      const m2 = mount(<ThemedSlideCard slide={{ kind: "image", url: "https://cdn.example.com/a.png" } as never} appearance={undefined} />);
      assert.equal(m2.host.querySelector("[data-slide-checkerboard]"), null, "image slide: none");
      m2.unmount();
    } finally { flag.setLayerOrderV3Flag(null); }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
