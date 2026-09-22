"use client";

/**
 * "New smart playlist" — creates a rule-based service plan.
 *
 * Reuses the SAME rule editor as smart folders (SmartFolderDialog) so the two
 * features stay consistent and there is one validated rule surface, not two.
 * The dialog validates with the same `validateRules` the server uses, so an
 * incomplete rule is caught here rather than producing an empty playlist.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { SmartFolderDialog } from "@/components/operator/pro/left/SmartFolderDialog";

export function SmartPlaylistButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="A smart playlist fills itself from rules — you never drag songs into it"
        className="h-9 px-3 inline-flex items-center gap-1.5 border border-border rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30"
      >
        <Sparkles className="w-3.5 h-3.5" />
        New smart playlist
      </button>
      {open && (
        <SmartFolderDialog
          open
          onOpenChange={(v) => { if (!v) setOpen(false); }}
          target="songs"
          mode="playlist"
          onSaved={() => { setOpen(false); router.refresh(); }}
        />
      )}
    </>
  );
}
