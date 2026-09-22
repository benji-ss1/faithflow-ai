/**
 * Tell the OPERATOR when a picture or video fails to load — without ever
 * putting an error on the audience screen.
 *
 * Before this, a failed `<img>`/`<video>` was hidden and nothing more was said.
 * On a projector that is indistinguishable from "the designer wanted nothing
 * there", so an operator could run a whole service never knowing a background
 * silently vanished. The commonest cause is an HEVC `.mov` on Windows, which
 * plays perfectly on the Mac it was made on.
 *
 * The output surfaces stay clean: this only dispatches an event. Operator
 * surfaces listen and toast; `/live`, `/stage`, `/livestream` and NDI have no
 * listener, so nothing is ever drawn there.
 */
export const MEDIA_FAILURE_EVENT = "presentflow:media-failed";

export type MediaFailureDetail = { url: string; kind: "video" | "image" };

/** Same asset failing repeatedly (a loop, a re-render) must not spam. */
const reported = new Set<string>();

export function reportMediaFailure(url: string | undefined, kind: "video" | "image"): void {
  try {
    if (!url || typeof window === "undefined") return;
    const key = `${kind}:${url}`;
    if (reported.has(key)) return;
    reported.add(key);
    console.error(`[media] ${kind} failed to load: ${url}`);
    window.dispatchEvent(new CustomEvent<MediaFailureDetail>(MEDIA_FAILURE_EVENT, { detail: { url, kind } }));
  } catch { /* never let reporting break a render */ }
}

/** Test/ops hook. */
export function resetMediaFailureLog(): void { reported.clear(); }
