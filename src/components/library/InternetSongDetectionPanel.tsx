"use client";

import { useMemo, useState } from "react";
import { Bot, LoaderCircle, Search, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import { matchSongCue } from "@/lib/ai-detection/song-match";
import type { IndexedSong } from "@/lib/ai-detection/lyric-fragment";
import type { InternetMetadataResult } from "@/lib/ai-detection/internet-metadata";
import { UnifiedSuggestionCard, type UnifiedSuggestionCardRecord } from "@/components/ai/UnifiedSuggestionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LibraryResponse = {
  songs: IndexedSong[];
};

type LookupResponse = {
  match: InternetMetadataResult | null;
  note?: string;
  error?: string;
};

async function loadLibrary() {
  const res = await fetch("/api/songs/library", { method: "GET" });
  if (!res.ok) throw new Error("Failed to load local library");
  return (await res.json()) as LibraryResponse;
}

function localResultToCard(result: Awaited<ReturnType<typeof matchSongCue>>[number]): UnifiedSuggestionCardRecord {
  return {
    id: `local-${result.songId}`,
    type: result.matchedLine ? "lyric_fragment" : "song_title",
    detected_phrase: result.matchedLine || result.title,
    normalized_query: result.title.toLowerCase(),
    matched_entity_id: result.songId,
    matched_title: result.title,
    source: result.source === "playlist" ? "current_service" : result.source === "public_domain" ? "public_domain" : "local_library",
    confidence: result.confidence / 100,
    availability: "ready",
    can_preview: true,
    can_send_live: true,
    reason:
      result.source === "playlist"
        ? "Matched a song already present in the current service context."
        : result.source === "public_domain"
          ? "Matched a local public-domain hymn with stored slides."
          : "Matched a church-scoped local song with safe stored content.",
    warning: null,
    status: "pending",
    subtitle: result.artist || null,
    actions: [
      { label: "Open song", href: `/library/songs/${result.songId}`, variant: "default" },
      { label: "Preview safe", disabled: false, variant: "outline" },
      { label: "Live-ready", disabled: false, variant: "outline" },
    ],
  };
}

function internetResultToCard(result: InternetMetadataResult, query: string): UnifiedSuggestionCardRecord {
  const metadataOnly = result.source === "musicbrainz";
  return {
    id: `internet-${result.externalId || query}`,
    type: "internet_metadata_result",
    detected_phrase: query,
    normalized_query: query.toLowerCase(),
    matched_entity_id: result.externalId || null,
    matched_title: result.title,
    subtitle: result.artist || null,
    source: "internet_metadata",
    confidence: Math.max(0, Math.min(1, result.confidence / 100)),
    availability: metadataOnly ? "metadata_only" : "unavailable",
    can_preview: false,
    can_send_live: false,
    reason: metadataOnly
      ? "Internet search confirmed likely title and artist metadata only."
      : "Internet lookup is currently degraded and did not return a rights-safe asset.",
    warning: "PresentFlow does not scrape lyrics from the open web and will not project copyrighted song text without a local or licensed source.",
    status: "pending",
    actions: [
      { label: "Search library", href: "/library/songs", variant: "default" },
      { label: "Connect provider", disabled: true, variant: "outline" },
      { label: "No live send", disabled: true, variant: "outline" },
    ],
  };
}

export function InternetSongDetectionPanel({ totalSongs }: { totalSongs: number }) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [results, setResults] = useState<UnifiedSuggestionCardRecord[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [libraryCache, setLibraryCache] = useState<IndexedSong[] | null>(null);
  const [usedInternetFallback, setUsedInternetFallback] = useState(false);

  const canSearch = title.trim().length >= 3 && !isLoading;
  const summary = useMemo(() => {
    if (results.length === 0) return "No results yet";
    const ready = results.filter((item) => item.availability === "ready").length;
    return `${ready} live-ready, ${results.length - ready} informational`;
  }, [results]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setUsedInternetFallback(false);
    setNote(null);
    try {
      const library = libraryCache ?? (await loadLibrary()).songs;
      if (!libraryCache) setLibraryCache(library);

      const localMatches = await matchSongCue(title.trim(), {
        churchId: "songs-library-preview",
        library,
        spokenCuePrefix: true,
      });

      const localCards = localMatches.map(localResultToCard);
      const strongLocal = localMatches[0]?.confidence >= 75;

      if (strongLocal || localCards.length >= 2) {
        setResults(localCards);
        setNote("Local library matched first, so internet metadata fallback was skipped.");
        return;
      }

      const response = await fetch("/api/ai/lookup-song-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), artist: artist.trim() || undefined }),
      });
      const payload = (await response.json()) as LookupResponse;
      if (!response.ok) throw new Error(payload.error || "Metadata lookup failed");

      const nextResults = [...localCards];
      if (payload.match) {
        nextResults.push(internetResultToCard(payload.match, title.trim()));
        setUsedInternetFallback(true);
      }

      setResults(nextResults);
      setNote(payload.note || (nextResults.length === 0 ? "No local or metadata result was found." : null));
    } catch (error) {
      setResults([]);
      setNote(error instanceof Error ? error.message : "Lookup failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,rgba(35,43,43,0.95),rgba(22,28,28,0.98))] shadow-[0_30px_80px_rgba(0,0,0,0.24)]">
      <div className="border-b border-white/8 px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Bot className="h-3.5 w-3.5 text-[var(--color-primary)]" />
              Internet-assisted detection
            </div>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">Local library first, metadata only on fallback</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              This lookup flow tests the future operator detection policy from a safe admin surface. PresentFlow checks the local church library first, boosts ready local assets, and only falls back to internet metadata without ever scraping open-web lyrics.
            </p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Library posture</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{totalSongs} songs</div>
            <div className="text-xs text-muted-foreground">{summary}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-3 rounded-[1.35rem] border border-white/8 bg-white/[0.03] p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Song title or cue
                </label>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Amazing Grace"
                  className="h-11 rounded-xl border-white/10 bg-black/10"
                />
              </div>
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Artist hint
                </label>
                <Input
                  value={artist}
                  onChange={(event) => setArtist(event.target.value)}
                  placeholder="Chris Tomlin"
                  className="h-11 rounded-xl border-white/10 bg-black/10"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="lg" disabled={!canSearch} className="rounded-2xl">
                {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Run detection
              </Button>
              <div className="text-xs text-muted-foreground">
                Minimum 3 characters. Internet results never include lyrics.
              </div>
            </div>
          </form>

          <div className="rounded-[1.35rem] border border-amber-500/20 bg-amber-500/6 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-200">
              <ShieldAlert className="h-4 w-4" />
              Guardrails
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>Local church songs and public-domain hymns rank first.</li>
              <li>Internet fallback returns title and artist metadata only.</li>
              <li>PresentFlow will not project unlicensed lyrics from open-web sources.</li>
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-[1.35rem] border border-white/8 bg-white/[0.03] px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Detection status</div>
              <div className="text-xs text-muted-foreground">{note || "Use this panel to inspect local-first vs metadata-only outcomes."}</div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-black/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {usedInternetFallback ? <Wifi className="h-3.5 w-3.5 text-cyan-300" /> : <WifiOff className="h-3.5 w-3.5 text-[var(--color-primary)]" />}
              {usedInternetFallback ? "Internet fallback used" : "Local-first path"}
            </div>
          </div>

          {results.length === 0 ? (
            <div className="rounded-[1.35rem] border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-center">
              <div className="text-base font-semibold text-foreground">No suggestion cards yet</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Search a known title to see ready local matches, or an unknown title to inspect the metadata-only fallback state.
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {results.map((result) => (
                <UnifiedSuggestionCard key={result.id} record={result} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
