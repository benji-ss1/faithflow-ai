"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Bot,
  Command,
  FileStack,
  FileText,
  Music4,
  ShieldAlert,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";

export type SuggestionCardType =
  | "scripture"
  | "song_title"
  | "lyric_fragment"
  | "command"
  | "sermon_slide"
  | "internet_metadata_result";

export type SuggestionCardSource =
  | "local_library"
  | "current_service"
  | "public_domain"
  | "internet_metadata"
  | "licensed_provider"
  | "operator_manual";

export type SuggestionCardAvailability =
  | "ready"
  | "metadata_only"
  | "license_required"
  | "unavailable"
  | "invalid";

export type SuggestionCardStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "edited"
  | "sent_live"
  | "dismissed";

export type SuggestionCardAction = {
  label: string;
  href?: string;
  disabled?: boolean;
  variant?: "default" | "secondary" | "outline" | "ghost";
  onClick?: () => void;
};

export type UnifiedSuggestionCardRecord = {
  id: string;
  type: SuggestionCardType;
  detected_phrase: string;
  normalized_query: string;
  matched_entity_id: string | null;
  matched_title: string;
  source: SuggestionCardSource;
  confidence: number;
  availability: SuggestionCardAvailability;
  can_preview: boolean;
  can_send_live: boolean;
  reason: string;
  warning: string | null;
  status: SuggestionCardStatus;
  actions: SuggestionCardAction[];
  subtitle?: string | null;
};

const TYPE_META: Record<SuggestionCardType, { label: string; icon: LucideIcon }> = {
  scripture: { label: "Scripture", icon: BookOpen },
  song_title: { label: "Song title", icon: Music4 },
  lyric_fragment: { label: "Lyric fragment", icon: FileText },
  command: { label: "Command", icon: Command },
  sermon_slide: { label: "Sermon slide", icon: FileStack },
  internet_metadata_result: { label: "Internet metadata", icon: Sparkles },
};

const SOURCE_LABEL: Record<SuggestionCardSource, string> = {
  local_library: "Church Library",
  current_service: "Current Service",
  public_domain: "Public Domain",
  internet_metadata: "Internet Metadata",
  licensed_provider: "Licensed Provider",
  operator_manual: "Operator Manual",
};

const STATUS_LABEL: Record<SuggestionCardStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  edited: "Edited",
  sent_live: "Sent Live",
  dismissed: "Dismissed",
};

function getConfidenceLabel(confidence: number) {
  if (confidence >= 0.9) return "High";
  if (confidence >= 0.65) return "Medium";
  return "Low";
}

function badgeClass(source: SuggestionCardSource) {
  switch (source) {
    case "current_service":
      return "border-[rgba(111,224,194,0.25)] bg-[rgba(111,224,194,0.08)] text-[var(--color-primary)]";
    case "public_domain":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "internet_metadata":
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-300";
    case "licensed_provider":
      return "border-violet-500/20 bg-violet-500/10 text-violet-300";
    case "operator_manual":
      return "border-white/10 bg-white/[0.05] text-foreground";
    default:
      return "border-white/10 bg-white/[0.03] text-muted-foreground";
  }
}

function availabilityTone(availability: SuggestionCardAvailability) {
  switch (availability) {
    case "ready":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "metadata_only":
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-300";
    case "license_required":
      return "border-amber-500/20 bg-amber-500/10 text-amber-300";
    case "invalid":
      return "border-red-500/20 bg-red-500/10 text-red-300";
    default:
      return "border-white/10 bg-white/[0.03] text-muted-foreground";
  }
}

export function UnifiedSuggestionCard({ record }: { record: UnifiedSuggestionCardRecord }) {
  const meta = TYPE_META[record.type];
  const Icon = meta.icon;

  return (
    <section className="overflow-hidden rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(35,43,43,0.78),rgba(22,28,28,0.96))] shadow-[0_22px_60px_rgba(0,0,0,0.22)]">
      <div className="border-b border-white/8 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {meta.label}
              </span>
              <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]", badgeClass(record.source))}>
                {SOURCE_LABEL[record.source]}
              </span>
              <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]", availabilityTone(record.availability))}>
                {record.availability.replace("_", " ")}
              </span>
            </div>
            <div className="truncate text-lg font-semibold tracking-[-0.03em] text-foreground">{record.matched_title}</div>
            {record.subtitle ? (
              <div className="mt-1 text-sm text-muted-foreground">{record.subtitle}</div>
            ) : null}
          </div>

          <div className="shrink-0 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Confidence</div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {getConfidenceLabel(record.confidence)} · {Math.round(record.confidence * 100)}%
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">{STATUS_LABEL[record.status]}</div>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Detected phrase</div>
            <div className="mt-2 text-sm font-medium text-foreground">{record.detected_phrase}</div>
            <div className="mt-2 text-xs leading-5 text-muted-foreground">
              Normalized query: <span className="font-mono text-[11px] text-foreground/85">{record.normalized_query}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Availability</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-medium text-foreground">
              {record.can_send_live ? (
                <Sparkles className="h-4 w-4 text-[var(--color-primary)]" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-amber-300" />
              )}
              {record.can_send_live ? "Live-ready asset available" : "Not live-ready"}
            </div>
            <div className="mt-2 text-xs leading-5 text-muted-foreground">{record.reason}</div>
          </div>
        </div>

        {record.warning ? (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div>{record.warning}</div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-white/8 pt-4">
          {record.actions.map((action) => {
            if (action.href) {
              return (
                <Link
                  key={action.label}
                  href={action.href}
                  className={cn(
                    buttonVariants({ size: "sm", variant: action.variant ?? "outline" }),
                    "rounded-xl border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                  )}
                >
                  {action.label}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              );
            }
            return (
              <Button
                key={action.label}
                type="button"
                size="sm"
                variant={action.variant ?? "outline"}
                onClick={action.onClick}
                disabled={action.disabled}
                className="rounded-xl border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
              >
                {action.label}
              </Button>
            );
          })}
          <div className="ml-auto text-[11px] text-muted-foreground">
            {record.matched_entity_id ? `Entity ${record.matched_entity_id}` : "No matched local entity"}
          </div>
        </div>
      </div>
    </section>
  );
}
