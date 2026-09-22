import { JSDOM } from "jsdom";
const dom = new JSDOM("<div id=root></div>", { url: "http://localhost" });
(global as any).window = dom.window; (global as any).document = dom.window.document;
(global as any).navigator = dom.window.navigator; (global as any).IS_REACT_ACT_ENVIRONMENT = true;
import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { resolveItemThemeConfig } from "./src/lib/live-item-theme";
import { themeConfigToAppearance } from "./src/lib/theme-appearance";

const modernCfg = { bgType: "gradient", bgColor: "#2b1055", bgColor2: "#7597de" } as any;
let setStyles!: (s: any) => void;
let observed: { card: any; live: any }[] = [];

function Console() {
  // mirrors OperatorConsole
  const themesByIdRef = useRef(new Map<string, unknown>([["modern", modernCfg]]));
  const [appearance] = useState<any>(null);              // church has NO default theme
  const [themesVersion] = useState(0);
  const [contentStyles, setCS] = useState<any>({});      // {} on first render (SSR parity)
  setStyles = setCS;
  const [liveItemIdx, setLive] = useState(0);
  const memo = useRef(new WeakMap<object, any>());
  const appearanceForConfig = useCallback((cfg: any) => {
    if (!cfg) return null;
    if (!memo.current.has(cfg)) memo.current.set(cfg, themeConfigToAppearance(cfg));
    return memo.current.get(cfg) ?? null;
  }, []);
  const items = useRef([{ type: "song" }]).current as any[];
  const liveCfg = resolveItemThemeConfig(items[liveItemIdx], contentStyles, (id) => themesByIdRef.current.get(id));
  const effectiveAppearance = useMemo(() => (liveCfg ? appearanceForConfig(liveCfg) : null) ?? appearance,
    [liveCfg, appearance, themesVersion, appearanceForConfig]);
  const appearanceForItem = useCallback((i: number) => {
    const cfg = resolveItemThemeConfig(items[i], contentStyles, (id) => themesByIdRef.current.get(id));
    return (cfg ? appearanceForConfig(cfg) : null) ?? appearance;
  }, [items, contentStyles, appearance, appearanceForConfig, themesVersion]);
  // ctx memo — deps copied from OperatorConsole.tsx:2905 (NO appearanceForItem / appearance / contentStyles / themesVersion)
  const ctx = useMemo(() => ({ appearanceForItem, appearance: effectiveAppearance, liveAppearance: effectiveAppearance, previewItemIdx: 0 }),
    [effectiveAppearance]);
  useEffect(() => { void setLive; }, []);
  observed.push({ card: ctx.appearanceForItem(ctx.previewItemIdx), live: ctx.liveAppearance ?? ctx.appearance });
  return null;
}
const root = createRoot(document.getElementById("root")!);
act(() => { root.render(React.createElement(Console)); });
// content-type styles land (song → Modern) — the effect that runs after mount
act(() => { setStyles({ song: "modern" }); });
const last = observed[observed.length - 1];
console.log("renders:", observed.length);
console.log("CARD appearance:", JSON.stringify(last.card));
console.log("LIVE appearance:", JSON.stringify(last.live));
