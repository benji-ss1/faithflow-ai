"use client";
import { useCallback, useEffect, useState } from "react";

export type CustomTheme = {
  id: string;
  name: string;
  textColor: string;
  bgColor: string;
  accentColor: string;
  fontFamily: string;
};

export type BlankSlideDef = {
  id: string;
  name: string;
  baseThemeId: string;
  bgColor?: string;
};

const CUSTOM_KEY = "presentflow.pro.customThemes.v1";
const BLANK_KEY = "presentflow.pro.blankSlides.v1";
const CUSTOM_EVT = "presentflow:custom-themes-updated";
const BLANK_EVT = "presentflow:blank-slides-updated";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}

function writeJson<T>(key: string, value: T, evt: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
  try { window.dispatchEvent(new CustomEvent(evt)); } catch { /* noop */ }
}

export function useCustomThemes() {
  const [themes, setThemes] = useState<CustomTheme[]>(() => readJson<CustomTheme[]>(CUSTOM_KEY, []));

  useEffect(() => {
    const refresh = () => setThemes(readJson<CustomTheme[]>(CUSTOM_KEY, []));
    window.addEventListener("storage", refresh);
    window.addEventListener(CUSTOM_EVT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(CUSTOM_EVT, refresh);
    };
  }, []);

  const add = useCallback((t: Omit<CustomTheme, "id">) => {
    const cur = readJson<CustomTheme[]>(CUSTOM_KEY, []);
    const next: CustomTheme = { id: `ct_${Date.now()}`, ...t };
    writeJson(CUSTOM_KEY, [...cur, next], CUSTOM_EVT);
    setThemes([...cur, next]);
  }, []);

  const remove = useCallback((id: string) => {
    const cur = readJson<CustomTheme[]>(CUSTOM_KEY, []);
    const next = cur.filter((t) => t.id !== id);
    writeJson(CUSTOM_KEY, next, CUSTOM_EVT);
    setThemes(next);
  }, []);

  return { themes, add, remove };
}

export function useBlankSlides() {
  const [slides, setSlides] = useState<BlankSlideDef[]>(() => readJson<BlankSlideDef[]>(BLANK_KEY, []));

  useEffect(() => {
    const refresh = () => setSlides(readJson<BlankSlideDef[]>(BLANK_KEY, []));
    window.addEventListener("storage", refresh);
    window.addEventListener(BLANK_EVT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(BLANK_EVT, refresh);
    };
  }, []);

  const add = useCallback((s: Omit<BlankSlideDef, "id">) => {
    const cur = readJson<BlankSlideDef[]>(BLANK_KEY, []);
    const next: BlankSlideDef = { id: `bs_${Date.now()}`, ...s };
    writeJson(BLANK_KEY, [...cur, next], BLANK_EVT);
    setSlides([...cur, next]);
  }, []);

  const remove = useCallback((id: string) => {
    const cur = readJson<BlankSlideDef[]>(BLANK_KEY, []);
    const next = cur.filter((s) => s.id !== id);
    writeJson(BLANK_KEY, next, BLANK_EVT);
    setSlides(next);
  }, []);

  return { slides, add, remove };
}
