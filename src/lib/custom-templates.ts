// Operator-saved slide templates. A slide's layout (objects + background) can be
// saved and reused across slides/songs. Stored per-machine in localStorage,
// scoped by churchId so a shared machine doesn't leak layouts between churches.
// Deliberately client-only + best-effort (a corrupt/oversized store never
// throws) — this is a convenience layer, not source-of-truth data.
import type { SlideObject } from "./slide-objects";

export type CustomTemplate = {
  id: string;
  name: string;
  bgColor?: string;
  bgImageUrl?: string;
  objects: SlideObject[];
};

const MAX_TEMPLATES = 40;
const key = (churchId: string) => `presentflow.customTemplates.${churchId}.v1`;

export function loadCustomTemplates(churchId: string): CustomTemplate[] {
  if (typeof window === "undefined" || !churchId) return [];
  try {
    const raw = window.localStorage.getItem(key(churchId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((t): t is CustomTemplate =>
      !!t && typeof t.id === "string" && typeof t.name === "string" && Array.isArray(t.objects));
  } catch {
    return [];
  }
}

function persist(churchId: string, list: CustomTemplate[]): CustomTemplate[] {
  const capped = list.slice(0, MAX_TEMPLATES);
  try { window.localStorage.setItem(key(churchId), JSON.stringify(capped)); } catch { /* quota/full — ignore */ }
  return capped;
}

export function saveCustomTemplate(churchId: string, tpl: Omit<CustomTemplate, "id">): CustomTemplate[] {
  if (typeof window === "undefined" || !churchId) return loadCustomTemplates(churchId);
  const id = `ct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const next = [{ ...tpl, id }, ...loadCustomTemplates(churchId)];
  return persist(churchId, next);
}

export function deleteCustomTemplate(churchId: string, id: string): CustomTemplate[] {
  if (typeof window === "undefined" || !churchId) return loadCustomTemplates(churchId);
  return persist(churchId, loadCustomTemplates(churchId).filter((t) => t.id !== id));
}
