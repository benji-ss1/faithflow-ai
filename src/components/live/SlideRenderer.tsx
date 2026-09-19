"use client";
import { fontStack } from "@/lib/fonts/registry";
import { useEffect, useRef, useCallback, useState } from "react";
import { BAND_FALLBACK_BG, CANVAS_H, CANVAS_W, bandCaptionPx, bandEdgeShadow, bandMediaBox, fitMediaInBox, videoObjectFit } from "@/lib/band-media";
import { SLIDE_CANVAS_W, SLIDE_CANVAS_H, type SlidePayload, type ThemeAppearance, type ScriptureBandWire, type ThemeFrameWire, type SlideObjectWire } from "@/lib/broadcast";
import { themedObjectTextColor, coversCanvas } from "@/lib/slide-objects";
import { themeBoxesAllowed as themeBoxesAllowedFor, themeDecorFor, themeDecorPlan } from "@/lib/theme-decor-plan";
import { AutoFitText } from "./AutoFitText";
import { AnimatedThemeBg } from "./ThemeLayers";
import { SlideObjectsLayer } from "./SlideObjectsLayer";

// Drop-shadow applied to text ONLY in the OBS/NDI transparent-overlay mode
// (transparentBg). There's no background scrim in that mode, so this keeps white
// lyrics/verses legible when OBS composites them over a bright/busy camera feed.
// Layered for two failure modes: a soft dark halo for busy backgrounds, PLUS
// four 1px opaque offset copies that approximate a solid dark outline so white
// text survives even over a bright/white wall (font-agnostic — safer than
// -webkit-text-stroke, which thins some display faces).
const OBS_OVERLAY_TEXT_SHADOW =
  "0 2px 10px rgba(0,0,0,0.85), 0 0 5px rgba(0,0,0,0.9), " +
  "1px 1px 0 rgba(0,0,0,0.95), -1px 1px 0 rgba(0,0,0,0.95), " +
  "1px -1px 0 rgba(0,0,0,0.95), -1px -1px 0 rgba(0,0,0,0.95)";
// Container-level halo for DESIGNED (multi-object) slides, whose text/image
// objects carry their own styles — a filter drop-shadow lifts every child off a
// busy camera without rewriting each object's per-object CSS. Stacked to match
// the near-outline strength of OBS_OVERLAY_TEXT_SHADOW (a soft halo PLUS tight
// 1px offset copies) so designed scripture/song slides stay legible over a
// bright/white wall, not just over a dark stage.
const OBS_OVERLAY_DROP_SHADOW =
  "drop-shadow(0 0 2px rgba(0,0,0,0.95)) drop-shadow(1px 1px 0 rgba(0,0,0,0.9)) " +
  "drop-shadow(-1px -1px 0 rgba(0,0,0,0.9)) drop-shadow(0 2px 6px rgba(0,0,0,0.85))";

/** True when the active theme has a running animated (solid/gradient) background
 *  and this slide isn't over video / per-slide-coloured — i.e. AnimatedThemeBg
 *  will render and the text must be lifted to z-[1] to stay on top.
 *
 *  Perf note: this only fires when `appearance` is passed, which today is ONLY
 *  the real output surfaces (live/stage/livestream/OutputSlide). Operator
 *  thumbnail grids render <SlideRenderer> WITHOUT appearance, so they spin up no
 *  animated GPU layers. If you ever thread `appearance` into a many-tile grid,
 *  gate the animation off there — N concurrent full-screen transform layers. */
function usesAnimatedBg(appearance: ThemeAppearance | null | undefined, overVideo?: boolean, slideBgColor?: string): boolean {
  if (overVideo || slideBgColor) return false;
  const a = appearance?.bgAnimation;
  return !!a && a !== "none" && appearance?.bgType !== "image" && appearance?.bgType !== "video";
}

// Every song/scripture slide is stored with a NON-NULL default bgColor of
// "#000000" (schema.ts). A truthy slide.bgColor beats the theme background AND
// Background Templates in the designBg precedence below — so that default black
// silently SUPPRESSED every theme/template background on the projector (it
// rendered black, and a projector shows black as an unlit white/grey screen).
// Treat the default black as "no per-slide background set" so the theme/template
// shows through; a NON-default colour the operator actually chose still wins.
function isDefaultSlideBg(c: string | null | undefined): boolean {
  if (!c) return true;
  const v = c.trim().toLowerCase();
  return v === "#000000" || v === "#000" || v === "black" || v === "rgb(0,0,0)" || v === "rgb(0, 0, 0)";
}

// ── Themes Phase 1: compute CSS from the active theme appearance ───────────
// Background supports solid / gradient / image, with an optional dark "dim"
// overlay for text readability (a single `background` shorthand — image/gradient
// layered under a dim gradient). Returns the built-in fallback when no theme is
// active. The values are validated on the wire (isValidThemeAppearance), and a
// hostile string can't break out of the single `background`/`color` CSS property
// (CSSOM parses each property in isolation).
export function themeBackgroundStyle(appearance: ThemeAppearance | null | undefined, fallback: string): React.CSSProperties {
  if (!appearance) return { background: fallback };
  const dim = typeof appearance.dim === "number" && appearance.dim > 0 ? Math.min(1, appearance.dim) : 0;
  const dimLayer = dim > 0 ? `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim}))` : null;
  let base: string | undefined;
  if (appearance.bgType === "image" && appearance.bgImageUrl) {
    base = `url("${appearance.bgImageUrl}")`;
  } else if (appearance.bgType === "gradient" && appearance.bgColor) {
    base = `linear-gradient(${appearance.bgAngle ?? 180}deg, ${appearance.bgColor}, ${appearance.bgColor2 ?? appearance.bgColor})`;
  } else if (appearance.bgColor) {
    base = appearance.bgColor;
  }
  if (!base) return { background: fallback };
  return {
    background: dimLayer ? `${dimLayer}, ${base}` : base,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
}

// Pick a readable text color for a background color when the theme didn't
// specify one — prevents the "white text on a light theme = invisible verses"
// failure. Only handles hex (the common case); rgb()/unknown default to white
// (safe on the dark fallback). Perceptual luminance threshold.
function readableTextColor(bg: string | undefined): string {
  if (!bg) return "#ffffff";
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(bg.trim());
  if (!m) return "#ffffff";
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#111111" : "#ffffff";
}

export function themeTextStyle(appearance: ThemeAppearance | null | undefined): React.CSSProperties | undefined {
  if (!appearance) return undefined;
  const s: React.CSSProperties = {};
  if (appearance.textColor) s.color = appearance.textColor;
  // No explicit text color but a solid/gradient background color is set →
  // auto-pick black/white for contrast so scripture stays legible.
  else if (appearance.bgColor && (appearance.bgType === "solid" || appearance.bgType === "gradient" || appearance.bgType === undefined)) {
    s.color = readableTextColor(appearance.bgColor);
  }
  if (appearance.fontFamily) s.fontFamily = fontStack(appearance.fontFamily);
  if (typeof appearance.fontWeight === "number") s.fontWeight = appearance.fontWeight;
  if (appearance.align) s.textAlign = appearance.align;
  if (appearance.textShadow === false) s.textShadow = "none";
  return Object.keys(s).length ? s : undefined;
}

// ── Theme → Projector (PR 2): theme text boxes ─────────────────────────────
/** Absolute %-box for a theme frame inside the 1920×1080 slide surface. */
export function themeFrameBoxStyle(f: Pick<ThemeFrameWire, "x" | "y" | "w" | "h">): React.CSSProperties {
  return {
    position: "absolute",
    left: `${(f.x / SLIDE_CANVAS_W) * 100}%`,
    top: `${(f.y / SLIDE_CANVAS_H) * 100}%`,
    width: `${(f.w / SLIDE_CANVAS_W) * 100}%`,
    height: `${(f.h / SLIDE_CANVAS_H) * 100}%`,
  };
}

/** The frame's own text style (only the keys the theme actually set). */
export function themeFrameTextStyle(f: ThemeFrameWire): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (f.color) s.color = f.color;
  if (f.fontFamily) s.fontFamily = fontStack(f.fontFamily);
  if (typeof f.fontWeight === "number") s.fontWeight = f.fontWeight;
  if (f.align) s.textAlign = f.align;
  if (f.italic) s.fontStyle = "italic";
  if (f.uppercase === true) s.textTransform = "uppercase";
  else if (f.uppercase === false) s.textTransform = "none";
  if (f.shadow === false) s.textShadow = "none";
  return s;
}

/** Frame for a text object (a theme-scripture verse carries its own geometry). */
function frameOfObject(o: Extract<SlideObjectWire, { kind: "text" }>): ThemeFrameWire {
  const f: ThemeFrameWire = { x: o.x, y: o.y, w: Math.max(40, o.w), h: Math.max(40, o.h) };
  if (o.fontFamily) f.fontFamily = o.fontFamily;
  if (typeof o.fontSize === "number") f.fontSize = o.fontSize;
  if (typeof o.fontWeight === "number") f.fontWeight = o.fontWeight;
  if (o.color) f.color = o.color;
  if (o.align) f.align = o.align;
  if (typeof o.italic === "boolean") f.italic = o.italic;
  if (typeof o.uppercase === "boolean") f.uppercase = o.uppercase;
  if (typeof o.shadow === "boolean") f.shadow = o.shadow;
  return f;
}

/**
 * Auto-fit text inside a theme box. projectorFit is OFF so AutoFitText measures
 * THIS box (the projector-fit path sizes against the whole canvas and would
 * overflow a smaller box); pagination is OFF (the projector has no page-advance)
 * so the whole text shrinks to fit — never clipped. The frame font size is the
 * fit CEILING, raised by the operator's A+ scale (same pattern as the band).
 */
function ThemeFramedText({ frame, text, fontScale, textMinPx, className, textStyle, editable, onEditInput }: {
  frame: ThemeFrameWire; text: string; fontScale?: number; textMinPx?: number; className?: string;
  textStyle?: React.CSSProperties; editable?: boolean; onEditInput?: (text: string) => void;
}) {
  const scale = fontScale && fontScale > 0 ? fontScale : 1;
  return (
    <div data-theme-frame="" style={themeFrameBoxStyle(frame)}>
      <AutoFitText
        text={text}
        maxPx={Math.min(400, Math.max(8, Math.round((frame.fontSize ?? 120) * Math.max(1, scale))))}
        // Long text must stay INSIDE the box: allow shrinking well below the
        // 24px readability floor rather than spilling out of it.
        minPx={Math.min(textMinPx ?? 8, 8)}
        paddingRatio={0.03}
        projectorFit={false}
        disablePagination
        fontScale={scale}
        className={className}
        textStyle={textStyle}
        editable={editable}
        onEditInput={onEditInput}
      />
    </div>
  );
}

type SlideRendererProps = {
  slide: SlidePayload;
  className?: string;
  // Phase 2a: rendering as an overlay ON TOP of a live video layer. Makes
  // text/blank backgrounds transparent (video shows through); the parent
  // supplies a readability scrim. Theme text styling still applies.
  overVideo?: boolean;
  // OBS/NDI transparent overlay (2026-08-26): force a FULLY transparent slide
  // background (alpha:0) — theme bg, per-slide bg AND the empty/blank fills are
  // all skipped, so ONLY the lyric/verse/objects render and everything else is
  // transparent for OBS to composite over the camera. Distinct from `overVideo`
  // (which is about an in-app video layer + keeps per-slide bg precedence). The
  // TEXT styling (theme font/colour/size) still applies so the overlay matches
  // the projector. Highest-precedence background rule when set.
  transparentBg?: boolean;
  // Vertical placement of lyrics over a live camera/video ("move the lyrics").
  // Only meaningful with overVideo (the reserve gives slack to move within);
  // scripture (with a reference footer) stays centred to avoid footer overlap.
  verticalAlign?: "top" | "center" | "bottom";
  // Themes Phase 1: active theme appearance (background + text styling) from
  // OutputState. Undefined ⇒ built-in defaults (dark bg, white text). A per-slide
  // `bgColor` still overrides the theme background. Applies to text/blank kinds;
  // image/video/logo slides keep their own full-bleed rendering.
  appearance?: ThemeAppearance | null;
  // B3 (2026-08-11): operator manual text-size multiplier (AUTO = 1.0),
  // threaded to AutoFitText for text slides. Undefined ⇒ AUTO.
  fontScale?: number;
  // Independent reference-footer size multiplier (default 1). Operator-set via
  // the Bible "reference size" control; sizes the footer on its own, separate
  // from the verse-body fontScale.
  referenceScale?: number;
  // Operator-chosen reference footer colour (overrides the theme text colour for the footer only).
  referenceColor?: string;
  // 2026-07-25: pass-through to AutoFitText for text slides. Grid cards
  // use small values to fit whole verses at a glance; live projector uses
  // the sanctuary-readability default.
  textMinPx?: number;
  disablePagination?: boolean;
  // 2026-07-27 JPD Fix 2: projector-surface sizing — word-count-banded
  // % of container height with a hard 3%-of-height floor. Only the /live
  // and /stage output routes pass this; thumbnails/previews are untouched.
  projectorFit?: boolean;
  // 2026-08-01: video audio control. Defaults to muted for operator previews
  // and thumbnails. The /live and /livestream routes pass false to enable audio.
  // Electron's autoplay policy allows unmuted autoplay without user gesture.
  videoMuted?: boolean;
  // 2026-08-01: expose the <video> element to the parent (e.g. /live page)
  // so it can apply media-control commands and report media-status.
  onVideoRef?: (el: HTMLVideoElement | null) => void;
  // In-place Quick Edit: make the single text element editable (song text slides
  // only). Threaded straight to AutoFitText. Parent freezes `slide.text` while
  // editing so the caret + fit stay stable.
  editable?: boolean;
  onEditInput?: (text: string) => void;
  // OBS editor "Over your camera" hints (2026-09-14, src/lib/obs-look.ts). Only
  // /livestream (and the OBS editor preview) pass it, and it only acts together
  // with transparentBg. Undefined ⇒ byte-identical legacy render.
  obsOverlay?: { textColor?: string; textShadow?: string; verticalAlign?: "top" | "center" | "bottom"; scrim?: number };
  /**
   * The fraction of the canvas HEIGHT this slide is actually drawn into, when a
   * caller renders it inside a band (the camera lower-third is 38%). The text fit
   * sizes against the fixed canvas, so without this it sized lower-third lyrics for
   * ~93% of the frame and they clipped out of the band. Undefined ⇒ full frame.
   */
  fitBandFraction?: number;
  /**
   * Theme → Projector (PR 2): render full-screen, ignoring the theme's text
   * boxes. The stage display (confidence monitor) opts out so the preacher
   * always reads the biggest possible text.
   */
  ignoreThemeLayout?: boolean;
  /**
   * Theme gaps (PR A): the output compositor hosts the theme background + decor
   * in a PERSISTENT layer behind the transition wrapper (so a decor video never
   * restarts per slide). When set AND this slide would paint theme decor
   * (themeDecorPlan non-null), the slide skips its in-slide decor/animated bg and
   * its theme background goes transparent. Text colour theming is unchanged.
   */
  themeChromeHosted?: boolean;
};

export function SlideRenderer(props: SlideRendererProps) {
  const { slide, className, textMinPx, disablePagination, projectorFit, videoMuted = true, onVideoRef, fontScale, referenceScale, referenceColor, appearance, overVideo, transparentBg, verticalAlign = "center", editable, onEditInput, obsOverlay, fitBandFraction, ignoreThemeLayout, themeChromeHosted } = props;
  const base = "w-full h-full flex items-center justify-center overflow-hidden";
  // Theme boxes apply only on a normal full-frame surface: never on stage
  // (ignoreThemeLayout), OBS/NDI transparent keying, a camera band, or lyrics
  // the operator moved over a camera. (The lower-third scripture band and
  // designed multi-object slides have their own branches below.)
  const decorFlags = { ignoreThemeLayout, transparentBg, fitBandFraction, overVideo, verticalAlign, editable };
  const themeBoxesAllowed = themeBoxesAllowedFor(decorFlags);
  const themeLayout = themeBoxesAllowed ? appearance?.layout : undefined;
  // Hosted: the compositor paints theme bg + decor persistently behind us.
  const hosted = !!themeChromeHosted && themeDecorPlan(slide, appearance, decorFlags) !== null;
  const themeBg = (fallback: string): React.CSSProperties => (hosted ? { background: "transparent" } : themeBackgroundStyle(appearance, fallback));
  // Theme decor (images/shapes/video/extra text from the theme slide), drawn
  // behind the slide text. Scripture uses the scripture slide's decor, falling
  // back to the lyrics slide's. Undefined ⇒ nothing extra rendered.
  const decorFor = (isScripture: boolean): SlideObjectWire[] | undefined => (hosted ? undefined : themeDecorFor(appearance, isScripture, decorFlags));
  // OBS overlay hints apply ONLY in transparent (OBS-key) mode.
  const obsHints = transparentBg ? obsOverlay : undefined;
  const obsTextOverride: React.CSSProperties = {
    ...(obsHints?.textColor ? { color: obsHints.textColor } : {}),
    ...(obsHints?.textShadow ? { textShadow: obsHints.textShadow } : {}),
  };
  const obsTransparentBg: React.CSSProperties = obsHints?.scrim && obsHints.scrim > 0
    ? { background: `rgba(0,0,0,${Math.min(0.9, obsHints.scrim)})` }
    : { background: "transparent" };
  const obsVAlign = obsHints?.verticalAlign && obsHints.verticalAlign !== "center" ? obsHints.verticalAlign : undefined;
  // A band can only ever make the fit smaller: take whichever reserve is larger.
  const bandReserve = typeof fitBandFraction === "number" && fitBandFraction > 0 && fitBandFraction < 1 ? 1 - fitBandFraction : 0;
  const withBand = (r: number) => Math.max(r, bandReserve);
  // Effective per-slide background: the DEFAULT black ("#000000") counts as
  // "unset" so the theme/template can show through (see isDefaultSlideBg). A
  // colour the operator actually customised still wins. Used by the song/
  // scripture (text) paths below — NOT the deliberate "blank" kind.
  const rawSlideBg = "bgColor" in slide ? slide.bgColor : undefined;
  const slideBg = rawSlideBg && !isDefaultSlideBg(rawSlideBg) ? rawSlideBg : undefined;

  // A cleared slide is transparent in overlay mode (camera shows through in OBS)
  // AND when a Background Template / theme video sits behind it (overVideo) — so a
  // cleared slide reveals the active template instead of a hard black box. This
  // matches the `blank` branch below. Without a template/camera behind (overVideo
  // false, not transparent) an empty slide stays opaque black (nothing behind to
  // reveal → the projector goes black, the correct "cleared" state). This also
  // fixes the LAYERS_V2 path: the compositor wraps each layer in an `absolute`
  // opacity container, which flips the empty slide's paint order ABOVE the
  // absolute BackgroundLayer (in the legacy/preview path the empty slide is
  // `position:static`, so the absolute template paints on top of it) — a
  // transparent empty slide keeps the template visible in BOTH paths.
  if (slide.kind === "empty") return <div className={`${base} ${(transparentBg || overVideo) ? "" : "bg-black"} ${className || ""}`} />;

  if (slide.kind === "blank") {
    // Over video OR in OBS transparent mode, a blank slide is fully transparent
    // (shows the live feed / camera). transparentBg ignores any per-slide bgColor
    // so "clear" always keys through.
    const bg = (overVideo || transparentBg) ? { background: "transparent" } : slide.bgColor ? { background: slide.bgColor } : themeBackgroundStyle(appearance, "#000000");
    const animated = usesAnimatedBg(appearance, overVideo || transparentBg, slide.bgColor);
    return (
      <div className={`${base} ${animated ? "relative" : ""} ${className || ""}`} style={bg}>
        {animated && <AnimatedThemeBg appearance={appearance} />}
      </div>
    );
  }

  if (slide.kind === "logo") {
    // OBS overlay contract is TEXT-over-camera. A holding/idle logo slide (shown
    // constantly between songs) must NOT paint an opaque black box over the live
    // camera on the stream — key it fully through so the camera stays clean.
    if (transparentBg) return <div className={`${base} ${className || ""}`} style={{ background: "transparent" }} />;
    return (
      <div className={`${base} bg-black relative ${className || ""}`}>
        {slide.url ? (
          <img src={slide.url} alt="Logo" className="max-w-[60%] max-h-[60%] object-contain" />
        ) : (
          <div className="text-white text-6xl font-display font-semibold tracking-tight">PresentFlow</div>
        )}
      </div>
    );
  }

  if (slide.kind === "text") {
    // ── Scripture "third" band (Christ Embassy mode) ────────────────────────
    // An isolated branch keyed on scriptureLayout — it never touches the
    // fullscreen designed-objects / soleText paths below. The verse is confined
    // to a band placed in the UPPER / MID / LOWER third (geometry carried on the
    // wire so a church can move it up off a high-mounted screen and nudge it past
    // overscan), auto-fit BIG within that band, with an optional coloured scrim
    // and the reference rendered INSIDE the band (so it tracks any position).
    // Works opaque (projector) or transparent (OBS overlay over the church feed).
    if (slide.scriptureLayout === "lowerThird") {
      const band = slide.scriptureBand;
      // Geometry from the wire; fall back to the original lower-third defaults so
      // an older paint-only wire still positions correctly.
      const bandTop = band?.topPct ?? 68;
      const bandH = band?.heightPct ?? 30;
      const vScale = band?.fontScale && band.fontScale > 0 ? band.fontScale : 1;
      const hasPaint = !!band?.color;
      const bandBg = hasPaint
        ? (band!.color2 ? `linear-gradient(${band!.angle ?? 180}deg, ${band!.color}, ${band!.color2})` : band!.color)
        : undefined;
      // Layout inside the band: a small pad, the verse fit-box, then the reference
      // line at the band's bottom. All in % of the canvas height.
      const pad = bandH * 0.06;
      const refH = bandH * 0.20;
      const verseTop = bandTop + pad;
      const verseH = Math.max(4, bandH - pad * 2 - refH);
      const ltRef = slide.reference?.trim();
      const refTop = bandTop + bandH - refH - pad * 0.5;
      // Reference size scales with band height (bigger band → bigger reference),
      // in canvas px so it scales with the surface via PresentationCanvas.
      const refPx = Math.round((bandH / 100) * 1080 * 0.11 * (referenceScale ?? 1));
      const themeTxt = (themeTextStyle(appearance)?.color as string | undefined);
      // Verse colour:
      //  • Over a band → auto-contrast against the OPERATOR'S band colour (a light
      //    band gets dark text, the default black band → white).
      //  • No band + OBS/transparent → force white over the unknown camera feed.
      //  • No band + opaque theme → the theme's readable text colour.
      // An explicit band textColor (set only by the OBS "Theme colours" style)
      // mirrors the projector's theme text colour verbatim; otherwise
      // auto-contrast as before (white over camera / readable over a band).
      const verseColor = band?.textColor
        ? band.textColor
        : hasPaint
          ? readableTextColor(band!.color)
          : transparentBg
            ? "#ffffff"
            : (themeTxt ?? "#ffffff");
      const shadowWhenBandless = (transparentBg || !hasPaint) ? { textShadow: OBS_OVERLAY_TEXT_SHADOW } : {};
      const ltBg: React.CSSProperties = (overVideo || transparentBg)
        ? { background: "transparent" }
        : slide.bgImageUrl
          ? { background: `#000 url("${slide.bgImageUrl}") center/cover no-repeat` }
          : themeBackgroundStyle(appearance, "#0b0b0b");
      return (
        <div className={`${base} relative ${className || ""}`} style={ltBg}>
          {hasPaint && (
            <div className="absolute inset-x-0 pointer-events-none" aria-hidden
              style={{ top: `${bandTop}%`, height: `${bandH}%`, background: bandBg, opacity: band!.opacity ?? 1, boxShadow: bandEdgeShadow(band!.color, band!.color2) }} />
          )}
          <div className="absolute" style={{ top: `${verseTop}%`, height: `${verseH}%`, left: "6%", width: "88%" }}>
            {/* projectorFit is deliberately OFF: the projector-fit path sizes vs the
               FULL 1920×1080 canvas (ignoring this box) → would overflow the band.
               OFF → AutoFitText measures THIS explicitly-sized box and fits the
               verse within the band (big for short verses, shrink for long ones) at
               every surface, since the box has real % dims (no shrink-wrap collapse). */}
            <AutoFitText
              text={slide.text}
              maxPx={Math.round(150 * vScale)}
              paddingRatio={0.03}
              projectorFit={false}
              // Pagination OFF: the live projector has no page-advance, so a
              // paginated verse would strand page 2+. Shrink the WHOLE verse to the
              // band instead. (The chunker splits genuinely-long verses upstream.)
              disablePagination
              // The band "Text size" (vScale) must MULTIPLY the fitted verse, not
              // merely raise maxPx: a normal verse fits its box well below the 150px
              // cap, so raising the cap alone is a no-op (field bug 2026-09-08). The
              // real size lever is AutoFitText's fontScale prop (shown = best*scale),
              // so fold vScale in there (× any incoming projector fontScale). maxPx
              // stays scaled so a scaled-up verse isn't clamped by the ceiling.
              fontScale={(fontScale && fontScale > 0 ? fontScale : 1) * vScale}
              className="font-display font-semibold"
              textStyle={{
                ...themeTextStyle(appearance),
                color: verseColor,
                textAlign: "center",
                textTransform: "none", // broadcast caption, not shouty lyric UPPERCASE
                ...shadowWhenBandless,
              }}
            />
          </div>
          {ltRef && (
            <div className="absolute flex items-center justify-center pointer-events-none"
              style={{ top: `${refTop}%`, height: `${refH}%`, left: "6%", width: "88%" }}>
              <span className="font-display font-semibold uppercase tracking-wide" style={{
                fontSize: `${refPx}px`, lineHeight: 1,
                opacity: 0.9, color: verseColor, ...(referenceColor ? { color: referenceColor } : {}),
                ...shadowWhenBandless,
              }}>{ltRef}</span>
            </div>
          )}
        </div>
      );
    }
    // Over video, the text sits transparently on the feed (parent adds a scrim);
    // otherwise use the per-slide bg color or the active theme background.
    // Rich object slide (ProPresenter-style): when the operator has designed a
    // positioned layout, render it verbatim instead of the auto-fit text block.
    // The per-slide design background (bgColor / bgImageUrl) wins over the theme.
    const objects = slide.objects;
    if (objects && objects.length > 0) {
      // When a background layer (Background Template / video / theme video) is
      // active behind the slide, the design surface must be TRANSPARENT so the
      // background shows through beneath the positioned objects — and we must
      // NOT flatten to the theme plain-text path (which drops every per-object
      // style and force-uppercases). Previously `!overVideo` skipped this whole
      // block, so designed slides (songs + scripture) lost their styling on any
      // church that had a background active. Rendering the objects over a
      // transparent surface keeps the live output pixel-identical to the editor.
      // Precedence: an explicit per-slide background (image/colour) is OPAQUE and
      // wins even over a background layer — this is how an edited MEDIA image
      // (bgColor "#000000") covers the theme. A slide with NO per-slide bg goes
      // transparent over the background layer so the theme shows through beneath
      // the objects (scripture/lyrics over the theme). Else the theme fill.
      // 2026-09-19 (owner: "BG works from Songs, not from a playlist item"): a
      // WORDS-ONLY slide (every visible object is text — a lyric / verse) whose
      // own bgColor is just a leftover theme bake (e.g. the near-black #010101 the
      // bake nudges a black theme to, or #0b0b0b) must NOT paint an opaque box over
      // an active Background Template / camera. Library sends are lyrics-only (no
      // objects_json) so they already showed the template; PLAN-item slides carry
      // the baked objects_json, took the opaque `slideBg` branch here and projected
      // plain black. This aligns the designed path with the plain-lyric path below
      // (template/camera BEATS a per-slide colour). An explicit per-slide IMAGE
      // (bgImageUrl) still wins, and a slide with any non-text object (a media
      // frame's logo/shape/backstop, a designed graphic) keeps its opaque colour.
      const wordsOnly = objects.every((o) => o.hidden || o.kind === "text");
      const slideColourYields = !!overVideo && wordsOnly;
      const designBg: React.CSSProperties = transparentBg
        ? obsTransparentBg // OBS overlay: only the objects render (+ optional editor scrim)
        : slide.bgImageUrl
          ? { background: `#000 url("${slide.bgImageUrl}") center/cover no-repeat` }
          : slideBg && !slideColourYields
            ? { background: slideBg }
            : overVideo
              ? { background: "transparent" }
              : themeBg("#0b0b0b");
      // Theme TEXT colour applies to a slide's objects only when the THEME
      // BACKGROUND is what's showing (the last branch above) — i.e. no per-slide
      // image/colour, no Background Template, no camera. In that case a per-object
      // DEFAULT-white fill should inherit the theme's textColor (that's the "theme
      // colour isn't applying to verses/songs" fix); an explicit non-white colour
      // still wins. Over the slide's own bg / a template / camera, objects keep
      // their designed colours. `undefined` = don't theme (keep object colour).
      const themeBgShowing = !transparentBg && !slide.bgImageUrl && !slideBg && !overVideo;
      // Use themeTextStyle's EFFECTIVE colour (explicit textColor OR the
      // readableTextColor auto-contrast for a solid/gradient theme bg) — not just
      // appearance.textColor — so object verses/songs on a LIGHT theme with no
      // explicit text colour render dark/legible, matching the plain-text path
      // (avoids white-on-light invisible verses).
      const themedTextColor = themeBgShowing ? ((themeTextStyle(appearance)?.color as string | undefined) ?? undefined) : undefined;
      // Lyric/verse slides are stored as a SINGLE centered text object (from
      // import or the slide editor). Rendering that at its stored ~96px font
      // makes it tiny on a sanctuary screen — the "songs project small" bug.
      // On the output/preview surfaces, fill the screen with it via the same
      // largest-fit engine as plain-text lyrics, so ALL lyrics are big and
      // crowd-readable and preview stays WYSIWYG with the projector. Genuinely
      // DESIGNED slides (2+ objects, or an image/shape/video) keep their exact
      // positioned layout via SlideObjectsLayer.
      const visible = objects.filter((o) => !o.hidden);
      const soleText = visible.length === 1 && visible[0].kind === "text" ? visible[0] : null;
      // Theme → Projector (PR 2): a scripture slide styled from a THEME carries
      // role-tagged text objects (verse + optional reference). Those render in
      // auto-fit boxes (never clipped) instead of fixed-size objects. Slides
      // without roles (saved Scripture Style, songs, designs) never enter here.
      const roleVerse = visible.find((o): o is Extract<SlideObjectWire, { kind: "text" }> => o.kind === "text" && o.role === "verse");
      const isThemeScripture = !!roleVerse && visible.every((o) => o.kind === "text" && (o.role === "verse" || o.role === "reference"));
      if (roleVerse && isThemeScripture) {
        const roleRef = visible.find((o): o is Extract<SlideObjectWire, { kind: "text" }> => o.kind === "text" && o.role === "reference");
        if (!themeBoxesAllowed) {
          // Stage / OBS key / camera modes stay full-screen: project the verse as
          // a plain scripture slide (reference footer only when the theme shows it).
          const plain: SlidePayload = roleRef && slide.reference
            ? { kind: "text", text: roleVerse.text, reference: slide.reference }
            : { kind: "text", text: roleVerse.text };
          return <SlideRenderer {...props} slide={plain} />;
        }
        const animated = !hosted && usesAnimatedBg(appearance, overVideo, slideBg || slide.bgImageUrl);
        const cls = `text-white font-display font-semibold${animated ? " relative z-[1]" : ""}`;
        const verseFrame = frameOfObject(roleVerse);
        const verseColor = themedObjectTextColor(roleVerse.color, themedTextColor);
        const sDecor = decorFor(true);
        return (
          <div className={`${base} relative ${className || ""}`} style={designBg}>
            {animated && <AnimatedThemeBg appearance={appearance} />}
            {sDecor && <SlideObjectsLayer objects={sDecor} themedTextColor={themedTextColor} decor />}
            <ThemeFramedText frame={verseFrame} text={roleVerse.text} fontScale={fontScale} textMinPx={textMinPx} className={cls}
              textStyle={{ ...themeTextStyle(appearance), ...themeFrameTextStyle(verseFrame), color: verseColor }} />
            {roleRef && (
              <ThemeFramedText frame={frameOfObject(roleRef)} text={roleRef.text} fontScale={referenceScale} textMinPx={textMinPx} className={cls}
                textStyle={{ ...themeTextStyle(appearance), ...themeFrameTextStyle(frameOfObject(roleRef)), color: themedObjectTextColor(roleRef.color, themedTextColor), ...(referenceColor ? { color: referenceColor } : {}) }} />
            )}
          </div>
        );
      }
      // Quick edit on a BLANK slide (Add slide copies the neighbour's text object
      // with text ""): in edit mode keep the single-text editable path so the
      // operator can type straight onto it. Gated on `editable`, so every
      // non-edit render (projector/stage/livestream/thumbnails) is unchanged.
      if (soleText && (soleText.text.trim() || editable)) {
        const animated = !hosted && usesAnimatedBg(appearance, overVideo || transparentBg, slideBg || slide.bgImageUrl);
        // Respect the operator's colour/font/weight/alignment; AutoFitText owns
        // the SIZE (fill-to-fit) + the always-on uppercase crowd-readability.
        const objStyle: React.CSSProperties = {
          // Default-white inherits the theme textColor when the theme bg is
          // showing; an explicit colour still wins (themedObjectTextColor).
          ...(soleText.color ? { color: themedObjectTextColor(soleText.color, themedTextColor) } : (themedTextColor ? { color: themedTextColor } : {})),
          // Render-time generic fallback only (stored object + identity untouched).
          ...(soleText.fontFamily ? { fontFamily: fontStack(soleText.fontFamily) } : {}),
          ...(soleText.fontWeight ? { fontWeight: soleText.fontWeight } : {}),
          ...(soleText.align ? { textAlign: soleText.align } : {}),
          ...(soleText.italic ? { fontStyle: "italic" } : {}),
          // Honour an explicit uppercase toggle so a single styled text object
          // (e.g. a reference-hidden scripture verse) stays one-to-one with the
          // editor. Undefined = leave AutoFitText's always-on lyric uppercase.
          ...(soleText.uppercase === false ? { textTransform: "none" } : soleText.uppercase === true ? { textTransform: "uppercase" } : {}),
          // OBS overlay: no background scrim, so a strong drop-shadow keeps white
          // text legible over ANY camera feed (bright/busy backgrounds).
          ...(transparentBg ? { textShadow: OBS_OVERLAY_TEXT_SHADOW } : {}),
          ...obsTextOverride,
        };
        // Decision 1: a song already themed as ONE text object uses the theme's
        // lyrics box (scripture — has a reference — keeps its own layout).
        const lyricFrame = !slide.reference ? themeLayout?.lyrics?.main : undefined;
        const soleDecor = !slide.reference ? decorFor(false) : undefined;
        if (lyricFrame) {
          return (
            <div className={`${base} relative ${className || ""}`} style={designBg}>
              {animated && <AnimatedThemeBg appearance={appearance} />}
              {soleDecor && <SlideObjectsLayer objects={soleDecor} themedTextColor={themedTextColor} decor />}
              <ThemeFramedText frame={lyricFrame} text={soleText.text} fontScale={fontScale} textMinPx={textMinPx}
                className={`text-white font-display font-semibold${animated ? " relative z-[1]" : ""}`}
                textStyle={{ ...themeTextStyle(appearance), ...themeFrameTextStyle(lyricFrame), ...objStyle }}
                editable={editable} onEditInput={onEditInput} />
            </div>
          );
        }
        return (
          <div className={`${base} ${animated || soleDecor ? "relative" : ""} ${className || ""}`} style={designBg}>
            {animated && <AnimatedThemeBg appearance={appearance} />}
            {soleDecor && <SlideObjectsLayer objects={soleDecor} themedTextColor={themedTextColor} decor />}
            <AutoFitText
              text={soleText.text}
              maxPx={120}
              minPx={textMinPx}
              paddingRatio={projectorFit ? 0.05 : 0.06}
              disablePagination={disablePagination}
              projectorFit={projectorFit}
              fontScale={fontScale}
              // Over a live camera/video: keep a vertical safe-area so lyrics
              // can't grow edge-to-edge and clip. When the operator moves the
              // lyrics off-centre, reserve MORE (smaller text) so there's room to
              // sit in the top/bottom portion over the camera.
              reserveVerticalRatio={withBand(obsVAlign ? 0.42 : overVideo ? (verticalAlign !== "center" ? 0.42 : 0.07) : 0)}
              verticalAlign={obsVAlign ?? (overVideo ? verticalAlign : "center")}
              className={`text-white font-display font-semibold${animated || soleDecor ? " relative z-[1]" : ""}`}
              textStyle={{ ...themeTextStyle(appearance), ...objStyle }}
              editable={editable}
              onEditInput={onEditInput}
            />
          </div>
        );
      }
      // Reference footer guarantee: scripture designed slides also carry a
      // `reference` field. Render the always-visible footer here too (as in the
      // plain-text path) UNLESS a visible object already shows that exact text
      // (dedupe — the operator may have a movable reference object instead).
      const dRefText = slide.reference?.trim();
      const dRefDupe = !!dRefText && objects.some((o) => o.kind === "text" && (o.role === "reference" || (!o.hidden && (o as { text?: string }).text?.trim() === dRefText)));
      const showDesignedFooter = !!dRefText && !dRefDupe;
      // OBS overlay: multi-object slides carry their own per-object styles, so a
      // container-level drop-shadow filter lifts every text/image object off a
      // busy camera without rewriting each object — the transparent-mode analogue
      // of the per-text textShadow used on the soleText/plain-text paths.
      const designedContainerStyle: React.CSSProperties = showDesignedFooter
        ? { ...designBg, paddingBottom: projectorFit ? "8%" : "12%" }
        : { ...designBg };
      if (transparentBg && obsHints?.textShadow !== "none") designedContainerStyle.filter = OBS_OVERLAY_DROP_SHADOW;
      // Theme gaps (PR A): theme decor behind a designed multi-object slide too
      // (never over a full-bleed media object, which is its own background).
      const dDecor = coversCanvas(objects) ? undefined : decorFor(!!dRefText);
      return (
        <div className={`${base} relative ${className || ""}`} style={designedContainerStyle}>
          {dDecor && <SlideObjectsLayer objects={dDecor} themedTextColor={themedTextColor} decor />}
          <SlideObjectsLayer objects={objects} fontScale={fontScale} themedTextColor={obsHints?.textColor ?? themedTextColor} referenceScale={referenceScale} referenceText={dRefText} />
          {showDesignedFooter && (
            <div className="absolute inset-x-0 bottom-0 flex justify-center pointer-events-none" style={{ paddingBottom: projectorFit ? "3.5%" : "2.5%" }}>
              <span className="font-display font-semibold uppercase tracking-wide" style={{
                fontSize: projectorFit ? `${(32 * (referenceScale ?? 1)).toFixed(1)}px` : `calc(clamp(11px, 4%, 20px) * ${referenceScale ?? 1})`,
                opacity: 0.82, ...themeTextStyle(appearance), ...(referenceColor ? { color: referenceColor } : {}),
                ...(transparentBg ? { textShadow: OBS_OVERLAY_TEXT_SHADOW } : {}),
              }}>{dRefText}</span>
            </div>
          )}
        </div>
      );
    }
    // Per-slide background precedence mirrors the designed-objects path above so a
    // plain (object-less) text/lyric slide with a dropped bgImageUrl actually
    // renders that image: OBS transparent wins first, then an explicit per-slide
    // image (opaque — covers a camera/template), then a per-slide colour, then the
    // theme. Previously bgImageUrl was ignored here, so a full-screen image slide
    // (or a background dropped onto a plain-lyric slide) rendered with no image
    // (field bug 6C: "background not fully set to the back of the image").
    const bg = transparentBg
      ? obsTransparentBg
      : slide.bgImageUrl
        ? { background: `#000 url("${slide.bgImageUrl}") center/cover no-repeat` }
        : overVideo
          ? { background: "transparent" }
          : slideBg
            ? { background: slideBg }
            : themeBg("#0b0b0b");
    const animated = !hosted && usesAnimatedBg(appearance, overVideo || transparentBg, slideBg || slide.bgImageUrl);
    const refText = slide.reference?.trim();
    // Theme → Projector (PR 2): the theme's lyrics box (songs/text) or verse +
    // reference boxes (scripture). No theme layout ⇒ the legacy full-frame
    // render below, byte-identical.
    const plainFrame = themeLayout ? (refText ? themeLayout.scripture?.verse : themeLayout.lyrics?.main) : undefined;
    const plainDecor = decorFor(!!refText);
    const plainDecorLayer = plainDecor
      ? <SlideObjectsLayer objects={plainDecor} themedTextColor={!slide.bgImageUrl && !slideBg && !overVideo ? ((themeTextStyle(appearance)?.color as string | undefined) ?? undefined) : undefined} decor />
      : null;
    if (plainFrame) {
      const cls = `text-white font-display font-semibold${animated ? " relative z-[1]" : ""}`;
      const baseStyle = { ...themeTextStyle(appearance), ...themeFrameTextStyle(plainFrame) };
      if (!refText) {
        return (
          <div className={`${base} relative ${className || ""}`} style={bg}>
            {animated && <AnimatedThemeBg appearance={appearance} />}
            {plainDecorLayer}
            <ThemeFramedText frame={plainFrame} text={slide.text} fontScale={fontScale} textMinPx={textMinPx} className={cls}
              textStyle={baseStyle} editable={editable} onEditInput={onEditInput} />
          </div>
        );
      }
      // Scripture: a reference box when the theme has one; otherwise the
      // reference sits inside the bottom of the verse box.
      const refBox = themeLayout?.scripture?.reference;
      const verseBox = refBox ? plainFrame : { ...plainFrame, h: plainFrame.h * 0.8 };
      const refFrame = refBox ?? {
        x: plainFrame.x, y: plainFrame.y + plainFrame.h * 0.8, w: plainFrame.w, h: plainFrame.h * 0.2,
        fontSize: Math.round((plainFrame.fontSize ?? 96) * 0.45),
        fontFamily: plainFrame.fontFamily, fontWeight: plainFrame.fontWeight, color: plainFrame.color, align: plainFrame.align,
      };
      return (
        <div className={`${base} relative ${className || ""}`} style={bg}>
          {animated && <AnimatedThemeBg appearance={appearance} />}
          {plainDecorLayer}
          <ThemeFramedText frame={verseBox} text={slide.text} fontScale={fontScale} textMinPx={textMinPx} className={cls} textStyle={baseStyle} />
          <ThemeFramedText frame={refFrame} text={refText} fontScale={referenceScale} textMinPx={textMinPx} className={cls}
            textStyle={{ ...themeTextStyle(appearance), ...themeFrameTextStyle(refFrame), textTransform: refFrame.uppercase === true ? "uppercase" : "none", ...(referenceColor ? { color: referenceColor } : {}) }} />
        </div>
      );
    }
    return (
      <div
        className={`${base} ${animated || plainDecor ? "relative" : ""} ${className || ""}`}
        // Reserve bottom room for the fixed reference footer so a long verse body
        // fits ABOVE it instead of overlapping.
        style={refText ? { ...bg, paddingBottom: projectorFit ? "8%" : "12%" } : bg}
      >
        {animated && <AnimatedThemeBg appearance={appearance} />}
        {plainDecorLayer}
        <AutoFitText
          text={slide.text}
          maxPx={120}
          minPx={textMinPx}
          // Tighter safe-area on the projector path (6% → 3.5%) so scripture &
          // lyrics use more of the screen — bigger crowd-readable text. Still
          // enough inset that letters never touch the bezel.
          paddingRatio={projectorFit ? 0.05 : 0.06}
          disablePagination={disablePagination}
          projectorFit={projectorFit}
          fontScale={fontScale}
          // Over a live camera/video: keep a vertical safe-area so lyrics/verses
          // don't grow edge-to-edge and clip. Scripture reserves the fixed
          // reference footer's room (the paddingBottom below is invisible to the
          // canvas-based fit) and stays centred. Songs honour the operator's
          // vertical placement — off-centre reserves more so there's room to move.
          // Reserve room for the reference footer in the FIT (not just CSS
          // padding, which the canvas fit ignores) so a long verse body shrinks
          // to sit ABOVE the footer instead of overlapping it — on the normal
          // projector path too, not only over a camera (2026-08-29 R2 fix).
          // Scripture footer reserve 0.12 → 0.15 (2026-09-16): the footer's padding is
          // CSS "8%", which is relative to WIDTH (0.08 × 1920 = 154px ≈ 0.142 of the
          // 1080 height), but the fit only reserved 0.12 (130px) — long verses
          // overshot by ~24px and lost their last line. 0.15 covers 16:9 and 4:3.
          reserveVerticalRatio={withBand(obsVAlign ? 0.42 : refText ? (overVideo ? 0.16 : 0.15) : (overVideo ? (verticalAlign !== "center" ? 0.42 : 0.07) : 0))}
          verticalAlign={obsVAlign ?? (overVideo && !refText ? verticalAlign : "center")}
          className={`text-white font-display font-semibold${animated || plainDecor ? " relative z-[1]" : ""}`}
          textStyle={transparentBg ? { ...themeTextStyle(appearance), textShadow: OBS_OVERLAY_TEXT_SHADOW, ...obsTextOverride } : themeTextStyle(appearance)}
          editable={editable}
          onEditInput={onEditInput}
        />
        {refText && (
          // Fixed always-visible reference footer. Kept OUT of the AutoFitText box
          // so it can never be shrunk to nothing or paginated off with a long
          // verse — the reference must always read at the bottom of the screen.
          <div
            className={`absolute inset-x-0 bottom-0 flex justify-center pointer-events-none${animated || plainDecor ? " z-[1]" : ""}`}
            style={{ paddingBottom: projectorFit ? "3.5%" : "2.5%" }}
          >
            <span
              className="font-display font-semibold uppercase tracking-wide"
              style={{
                // CANVAS-RELATIVE px (not vh): the footer lives inside the fixed
                // 1920×1080 PresentationCanvas that's CSS-transform-scaled to the
                // display, so a px value scales WITH the canvas — identical on the
                // projector and the operator preview. `vh` was window-relative, so
                // the operator's Ref-size change didn't track on the projector.
                fontSize: projectorFit
                  ? `${(32 * (referenceScale ?? 1)).toFixed(1)}px`
                  : `calc(clamp(11px, 4%, 20px) * ${referenceScale ?? 1})`,
                opacity: 0.82,
                ...themeTextStyle(appearance),
                // Operator-chosen reference colour wins over the theme text colour.
                ...(obsHints?.textColor ? { color: obsHints.textColor } : {}),
                ...(referenceColor ? { color: referenceColor } : {}),
                // OBS overlay: shadow the reference too, else the white footer
                // washes out over a bright camera while the verse body is shadowed.
                ...(transparentBg ? { textShadow: OBS_OVERLAY_TEXT_SHADOW } : {}),
                ...(obsHints?.textShadow ? { textShadow: obsHints.textShadow } : {}),
              }}
            >
              {refText}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (slide.kind === "image") {
    // Three fit modes (operator-selectable per image via the Media panel):
    //   contain (default — PPTX slides, most media): letterbox, whole image
    //     shown, never cropped or distorted.
    //   cover ("Fill"): fills the pane edge-to-edge, cropping overflow.
    //   fill  ("Stretch"): fills the pane exactly, distorting aspect if needed.
    // OBS overlay: media images belong on a dedicated OBS media scene, not the
    // text overlay — keying a letterboxed image on black would cover the camera.
    if (transparentBg) return <div className={`${base} ${className || ""}`} style={{ background: "transparent" }} />;
    const fitMode = slide.fit ?? "contain";
    const imgStyle: React.CSSProperties =
      fitMode === "cover"
        ? { width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", display: "block" }
        : fitMode === "fill"
          ? { width: "100%", height: "100%", objectFit: "fill", objectPosition: "center", display: "block" }
          : { maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", objectFit: "contain", objectPosition: "center", display: "block", margin: "auto" };
    // Blur-fill: for a letterboxed (contain) image — typically a portrait
    // flyer/iPhone photo on a 16:9 screen — fill the black bars with a blurred,
    // zoomed COVER copy of the same image instead of dead black, so the flyer
    // reads as a designed full-screen slide. Only meaningful for contain (cover/
    // fill already reach the edges). The blurred layer always matches because it
    // IS the same image.
    const showBlurFill = slide.blurFill === true && fitMode === "contain";
    // THIRD-BAND image (explicit per-slide layout only; the church default no longer bands media).
    if (slide.layout === "third" && slide.url) {
      const objectFit = fitMode === "fill" ? "fill" : fitMode === "cover" ? "cover" : "contain";
      const fitEl = (onNatural: (w: number, h: number) => void, box: React.CSSProperties) => (
        <img src={slide.url} alt="" style={{ ...box, objectFit, objectPosition: "center" }}
          ref={(el) => { if (el && el.complete && el.naturalWidth) onNatural(el.naturalWidth, el.naturalHeight); }}
          onLoad={(e) => onNatural(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />
      );
      const fullEl = (
        <div className="absolute inset-0 bg-black flex items-center justify-center overflow-hidden">
          <img src={slide.url} alt="" style={imgStyle} />
        </div>
      );
      return <ThirdBandMedia key={slide.url} base={base} className={className} band={slide.band} mode={slide.bandMode ?? "fit"} caption={slide.caption} appearance={appearance} media={fitEl} fullMedia={fullEl} />;
    }
    return (
      <div className={`${base} bg-black relative overflow-hidden ${className || ""}`}>
        {slide.url ? (
          <>
            {showBlurFill ? (
              <img
                src={slide.url}
                alt=""
                aria-hidden="true"
                style={{
                  position: "absolute", inset: 0, width: "100%", height: "100%",
                  objectFit: "cover", objectPosition: "center", display: "block",
                  filter: "blur(34px) brightness(0.62) saturate(1.08)",
                  transform: "scale(1.15)", // hide the blur's soft edges past the frame
                }}
              />
            ) : null}
            <img
              src={slide.url}
              alt=""
              style={showBlurFill ? { ...imgStyle, position: "relative", zIndex: 1 } : imgStyle}
              onError={(e) => {
                console.error("[slide] image failed to load:", (e.currentTarget as HTMLImageElement).src);
              }}
            />
          </>
        ) : (
          <div className="text-white text-xs opacity-50">Image not available</div>
        )}
      </div>
    );
  }

  if (slide.kind === "video") {
    // OBS overlay: don't render (or play the audio of) a media video on the text
    // overlay — it would black-box the camera and dump a second audio track into
    // the OBS page. Media video is a separate OBS scene.
    if (transparentBg) return <div className={`${base} ${className || ""}`} style={{ background: "transparent" }} />;
    // THIRD-BAND video: confine VideoSlide into the band (fit), or full video +
    // caption strip (caption). The nested VideoSlide fills its positioned box.
    if (slide.layout === "third" && slide.url) {
      const boxed = (onNatural: (w: number, h: number) => void, box: React.CSSProperties) => (
        <VideoSlide slide={slide} base="w-full h-full flex items-center justify-center overflow-hidden" videoMuted={videoMuted} onVideoRef={onVideoRef} fillBox={box} onNatural={onNatural} />
      );
      const full = <VideoSlide slide={slide} base="absolute inset-0 bg-black flex items-center justify-center overflow-hidden" videoMuted={videoMuted} onVideoRef={onVideoRef} fillBox={{ width: "100%", height: "100%", display: "block" }} />;
      return <ThirdBandMedia key={slide.url} base={base} className={className} band={slide.band} mode={slide.bandMode ?? "fit"} caption={slide.caption} appearance={appearance} media={boxed} fullMedia={full} />;
    }
    return <VideoSlide slide={slide} base={base} className={className} videoMuted={videoMuted} onVideoRef={onVideoRef} />;
  }

  return null;
}

/** Extracted so we can use hooks (useRef/useCallback) for stable ref handling.
 *  The inline ref callback in the parent was calling el.play() on every render,
 *  which auto-unpaused the video whenever React re-rendered. */
// Paint style for a media band (solid or gradient), or undefined for a
// transparent ("none") band. Mirrors the text band's paint.
function mediaBandPaint(band?: ScriptureBandWire): React.CSSProperties | undefined {
  if (!band?.color) return undefined;
  return {
    background: band.color2 ? `linear-gradient(${band.angle ?? 180}deg, ${band.color}, ${band.color2})` : band.color,
    opacity: band.opacity ?? 1,
    boxShadow: bandEdgeShadow(band.color, band.color2),
  };
}

// Render an image/video confined to the church's third-band. Two modes:
//  • "fit": the media sits centred in the band's inner box (same 6%/88% inset +
//    vertical pad as the scripture text band); the band paint spans the FULL band
//    width behind it, so it reads as a designed band. Never upscaled past 1.5×
//    natural size. Portrait/narrow media (aspect < 0.8) stays a centred thumbnail
//    at band height with the band still full width — applyChurchLayout defaults are
//    unchanged (an owner could later route narrow media full-screen instead).
//  • "caption": the media stays full-bleed and the band is a caption strip over
//    it showing `caption` text (band colour, or a default bottom scrim if none).
// Geometry defaults match the text band (top 68% / height 30%).
function ThirdBandMedia({ base, className, band, mode, caption, media, fullMedia, appearance }: {
  base: string; className?: string; band?: ScriptureBandWire;
  mode: "fit" | "caption"; caption?: string;
  media: (onNatural: (w: number, h: number) => void, box: React.CSSProperties) => React.ReactNode; fullMedia: React.ReactNode;
  appearance?: ThemeAppearance | null;
}) {
  const topPct = band?.topPct ?? 68;
  const heightPct = band?.heightPct ?? 30;
  const fontScale = band?.fontScale ?? 1;
  const paint = mediaBandPaint(band);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const onNatural = useCallback((w: number, h: number) => {
    setNat((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);
  // Fallback: media that never reports its natural size (errored / stalled
  // metadata) must not stay invisible — reveal it at box-fill size after 1.5s
  // (or immediately on error via onNatural(0,0)).
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (nat) return;
    const t = setTimeout(() => setRevealed(true), 1500);
    return () => clearTimeout(t);
  }, [nat]);
  if (mode === "caption") {
    // No band colour → default scrim so white caption text is legible on any photo.
    const scrim: React.CSSProperties = paint
      ? paint
      : { background: `linear-gradient(${topPct < 34 ? "to top" : "to bottom"}, rgba(0,0,0,0), rgba(0,0,0,0.55))` };
    return (
      <div className={`${base} relative overflow-hidden ${className || ""}`}>
        {fullMedia}
        <div style={{ position: "absolute", left: 0, right: 0, top: `${topPct}%`, height: `${heightPct}%`, ...scrim }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: `${topPct}%`, height: `${heightPct}%`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {caption ? (
            <span style={{ color: "#ffffff", textAlign: "center", padding: "0 6%", fontWeight: 700, lineHeight: 1.1, fontSize: `${bandCaptionPx(heightPct, fontScale)}px`, textShadow: "0 2px 8px rgba(0,0,0,0.65)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", maxHeight: "100%" }}>{caption}</span>
          ) : null}
        </div>
      </div>
    );
  }
  const box = bandMediaBox(topPct, heightPct);
  const size = nat && nat.w > 0 && nat.h > 0
    ? fitMediaInBox(nat.w, nat.h, (box.widthPct / 100) * CANVAS_W, (box.heightPct / 100) * CANVAS_H)
    : { wPct: 100, hPct: 100 };
  const mediaBox: React.CSSProperties = { width: "100%", height: "100%", display: "block", borderRadius: `${Math.round(CANVAS_W * 0.006)}px`, overflow: "hidden" };
  return (
    <div className={`${base} relative overflow-hidden ${className || ""}`} style={themeBackgroundStyle(appearance, BAND_FALLBACK_BG)}>
      {paint ? <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: `${topPct}%`, height: `${heightPct}%`, ...paint }} /> : null}
      <div style={{ position: "absolute", left: `${box.leftPct}%`, width: `${box.widthPct}%`, top: `${box.topPct}%`, height: `${box.heightPct}%`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", width: `${size.wPct}%`, height: `${size.hPct}%`, opacity: nat || revealed ? 1 : 0 }}>
          {media(onNatural, mediaBox)}
        </div>
      </div>
    </div>
  );
}

function VideoSlide({ slide, base, className, videoMuted, onVideoRef, fillBox, onNatural }: {
  slide: Extract<SlidePayload, { kind: "video" }>;
  base: string;
  className?: string;
  videoMuted: boolean;
  onVideoRef?: (el: HTMLVideoElement | null) => void;
  /** Band/caption use: fill this box (no black backing box). Absent = legacy full-screen styles, unchanged. */
  fillBox?: React.CSSProperties;
  onNatural?: (w: number, h: number) => void;
}) {
  const hasAutoPlayed = useRef(false);
  const lastUrl = useRef(slide.url);

  // Reset auto-play flag when the video URL changes (new video should auto-play)
  if (slide.url !== lastUrl.current) {
    lastUrl.current = slide.url;
    hasAutoPlayed.current = false;
  }

  const setRef = useCallback((el: HTMLVideoElement | null) => {
    if (el && !hasAutoPlayed.current) {
      hasAutoPlayed.current = true;
      el.play().catch((err) => console.warn("[slide] video play blocked:", err instanceof Error ? err.message : String(err)));
    }
    onVideoRef?.(el);
  }, [onVideoRef]);

  return (
    <div className={`${base}${fillBox ? "" : " bg-black"} relative ${className || ""}`}>
      <video
        onLoadedMetadata={onNatural ? (e) => onNatural(e.currentTarget.videoWidth, e.currentTarget.videoHeight) : undefined}
        src={slide.url}
        loop={slide.loop !== false}
        muted={videoMuted}
        preload="auto"
        playsInline
        onError={(e) => { onNatural?.(0, 0); console.warn("[slide] video error:", (e.currentTarget as HTMLVideoElement).error?.message || "unknown"); }}
        ref={setRef}
        style={fillBox ? { ...fillBox, objectFit: slide.fit === "cover" ? "cover" : "contain", objectPosition: "center" } : {
          // Full-screen: scale to the output like ProPresenter (contain = letterbox,
          // enlarge allowed; cover = crop; fill = stretch only when chosen).
          width: "100%",
          height: "100%",
          objectFit: videoObjectFit(slide.fit),
          objectPosition: "center",
          display: "block",
        }}
      />
    </div>
  );
}
