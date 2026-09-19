/**
 * The DOM fixture matrix for the PP7 draw-order parity tests.
 *
 * Route-shaped: each fixture is the props one output route hands the
 * OutputCompositor, plus the announcement that route used to paint as a SIBLING
 * after it. `test/fixtures/output-dom-main.golden.json` is the rendered markup
 * of `<OutputCompositor …/><AnnouncementLayer …/>` on `main`; with the
 * draw-order flag OFF the new compositor (which now owns the announcement) must
 * render byte-identical markup.
 */
import type { AnnouncementPayload, BackgroundSpec, SlidePayload, ThemeAppearance, VideoInputState } from "../src/lib/broadcast";
import type { CompositorMode } from "../src/lib/output-plan";

export interface DomFixture {
  name: string;
  mode: CompositorMode;
  slide: SlidePayload;
  appearance?: ThemeAppearance | null;
  background?: BackgroundSpec | null;
  videoInput?: VideoInputState | null;
  transparent?: boolean;
  transitionsEnabled?: boolean;
  aspectRatio?: "16:9" | "4:3";
  announcement?: AnnouncementPayload | null;
}

const text: SlidePayload = { kind: "text", text: "Amazing grace how sweet the sound", reference: "Hymn" };
const image: SlidePayload = { kind: "image", url: "https://x/i.png" };
const band: SlidePayload = { kind: "text", text: "Lower third", scriptureLayout: "lowerThird" };
const themeLogo = { textColor: "#fff", bgColor: "#101010", logoUrl: "https://x/logo.png", logoPosition: "bottom-right" } as ThemeAppearance;
const themeVideo = { textColor: "#fff", bgType: "video", bgVideoUrl: "https://x/t.mp4" } as ThemeAppearance;
const media = { type: "image", imageUrl: "https://x/bg.png" } as BackgroundSpec;
// A theme carrying DECOR (theme gaps PR A): plans the persistent `theme-decor`
// layer between the media and the words. In the matrix so the draw-order change
// is proved not to disturb it.
const themeDecor = {
  textColor: "#fff", bgColor: "#101010", logoUrl: "https://x/logo.png", logoPosition: "bottom-right",
  layout: { lyrics: { decor: [{ id: "d1", type: "image", url: "https://x/decor.png", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] } },
} as unknown as ThemeAppearance;
const cam = { deviceId: "cam-1" } as VideoInputState;
const camFull = { deviceId: "cam-1", overlay: "full" } as VideoInputState;
const camBand = { deviceId: "cam-1", overlay: "lower_third" } as unknown as VideoInputState;
const ann: AnnouncementPayload = {
  line1: "Welcome to the 9am service", line2: "Kids church downstairs",
  position: "lower_third",
  style: { fontFamily: "Inter", fontSizePx: 32, fontWeight: 600, textColor: "#fff", bgColor: "#000000", bgOpacity: 70, padding: 16, borderRadius: 8, align: "left" },
} as unknown as AnnouncementPayload;
const annLogo = { ...ann, position: "center_card", logo: { url: "https://x/ann.png", position: "top-right", sizePct: 12, opacity: 1 } } as unknown as AnnouncementPayload;

export function domMatrix(): DomFixture[] {
  const out: DomFixture[] = [];
  for (const mode of ["live", "stage", "livestream", "ndi"] as const) {
    out.push(
      { name: "plain text", mode, slide: text, appearance: themeLogo },
      { name: "text + media", mode, slide: text, appearance: themeLogo, background: media },
      { name: "text + camera", mode, slide: text, appearance: themeLogo, videoInput: cam },
      { name: "text + camera (full overlay)", mode, slide: text, appearance: themeLogo, videoInput: camFull },
      { name: "text + camera (lower third)", mode, slide: text, appearance: themeLogo, videoInput: camBand },
      { name: "text + camera + media", mode, slide: text, appearance: themeLogo, background: media, videoInput: cam },
      { name: "text + camera + media (full overlay)", mode, slide: text, appearance: themeLogo, background: media, videoInput: camFull },
      { name: "media-as-background slide", mode, slide: image, appearance: themeLogo, background: media },
      { name: "media slide over camera", mode, slide: image, appearance: themeLogo, videoInput: cam },
      { name: "theme video background", mode, slide: text, appearance: themeVideo },
      { name: "lower-third slide + camera", mode, slide: band, appearance: themeLogo, videoInput: cam },
      { name: "announcement alone", mode, slide: text, appearance: themeLogo, announcement: ann },
      { name: "announcement + props (logo)", mode, slide: text, appearance: themeLogo, background: media, announcement: ann },
      { name: "announcement w/ logo + props + camera + media", mode, slide: text, appearance: themeLogo, background: media, videoInput: cam, announcement: annLogo },
      { name: "announcement, no theme logo", mode, slide: text, appearance: themeVideo, announcement: ann },
      { name: "4:3", mode, slide: text, appearance: themeLogo, background: media, aspectRatio: "4:3", announcement: ann },
      { name: "theme decor", mode, slide: text, appearance: themeDecor },
      { name: "theme decor + media", mode, slide: text, appearance: themeDecor, background: media },
      { name: "theme decor + camera", mode, slide: text, appearance: themeDecor, videoInput: camFull },
      { name: "theme decor + camera + media", mode, slide: text, appearance: themeDecor, background: media, videoInput: camFull },
      { name: "theme decor + announcement", mode, slide: text, appearance: themeDecor, background: media, announcement: ann },
    );
    if (mode === "livestream" || mode === "ndi") {
      out.push(
        { name: "transparent key", mode, slide: text, appearance: themeLogo, background: media, videoInput: cam, transparent: true, announcement: ann },
        { name: "transparent key + transitions", mode, slide: text, appearance: themeLogo, videoInput: cam, transparent: true, transitionsEnabled: true },
      );
    }
  }
  return out;
}

export function domKey(f: DomFixture): string {
  return `${f.mode}|${f.name}`;
}
