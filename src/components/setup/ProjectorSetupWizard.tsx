"use client";
import { useEffect, useState, useCallback } from "react";
import { Monitor, Maximize2, CheckCircle2, AlertCircle, ArrowRight, ExternalLink } from "lucide-react";
import { toast } from "sonner";

/**
 * 6-step gated wizard. Each step blocks the next until confirmed.
 * Persists venue label + preferred display index to localStorage.
 * On real church deployments this pref should sync to the church_preferences
 * table so a volunteer switching devices gets the same setup — but for the
 * demo we keep it client-side to avoid a new schema round-trip during MVP.
 */
type StepKey = "detect" | "openLive" | "drag" | "testPattern" | "fullscreen" | "save";

export function ProjectorSetupWizard() {
  const [step, setStep] = useState<StepKey>("detect");
  const [screenCount, setScreenCount] = useState<number | null>(null);
  const [screenAPISupported, setScreenAPISupported] = useState<boolean>(false);
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
  const [testPatternConfirmed, setTestPatternConfirmed] = useState<boolean>(false);
  const [venueName, setVenueName] = useState<string>("");

  const detectScreens = useCallback(async () => {
    try {
      // Screen Details API — behind permission
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      if (typeof w.getScreenDetails === "function") {
        setScreenAPISupported(true);
        try {
          const details = await w.getScreenDetails();
          setScreenCount(details.screens?.length ?? 1);
          if ((details.screens?.length ?? 1) >= 2) setStep("openLive");
        } catch {
          setPermissionDenied(true);
          // Fallback to window.screen
          setScreenCount(1);
        }
      } else {
        setScreenAPISupported(false);
        // Best effort: use window.screen dimensions vs available
        setScreenCount(1);
      }
    } catch {
      setScreenCount(1);
    }
  }, []);

  useEffect(() => { detectScreens(); }, [detectScreens]);

  return (
    <div className="max-w-3xl space-y-4">
      {typeof window !== "undefined" && window.electronAPI && (
        <div className="rounded-md border border-blue-300 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100 px-3 py-2 text-xs">
          Desktop app detected. For per-display Projector / Stage / Livestream
          assignments, use the{" "}
          <a href="/settings/screens" className="underline font-semibold">
            Screen Configuration
          </a>{" "}
          page.
        </div>
      )}
      <Progress step={step} />

      {/* Step 1 — Detect displays */}
      <BubbleCard
        active={step === "detect"}
        done={step !== "detect"}
        icon={Monitor}
        what="We check how many displays are connected"
        why="A projector normally shows up as a second display. If we only see one, either the projector isn’t plugged in, or your Mac hasn’t switched to Extended Display mode yet."
      >
        {step === "detect" && (
          <>
            <div className="text-sm space-y-2">
              {screenCount === null ? (
                <div className="text-muted-foreground">Detecting…</div>
              ) : screenCount >= 2 ? (
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="w-4 h-4" />
                  {screenCount} displays detected. Great — projector is connected.
                </div>
              ) : (
                <div className="flex items-start gap-2 text-warning">
                  <AlertCircle className="w-4 h-4 mt-0.5" />
                  <div>
                    Only 1 display detected. Plug in the projector, then set it to
                    “Use as separate display” (System Settings → Displays → Arrange, or
                    Windows: PROJECT → Extend). Then press Recheck.
                  </div>
                </div>
              )}
              {!screenAPISupported && (
                <p className="text-xs text-muted-foreground italic">
                  Your browser can’t auto-detect exact screen count. That’s okay — proceed
                  once the projector shows a mirrored desktop.
                </p>
              )}
              {permissionDenied && (
                <p className="text-xs text-muted-foreground italic">
                  Screen access permission was declined. Click Recheck and Allow if you want auto-detection.
                </p>
              )}
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={detectScreens} className="h-9 px-3 text-xs border border-border rounded-md hover:bg-accent">
                Recheck
              </button>
              <button
                onClick={() => setStep("openLive")}
                className="h-9 px-3 text-xs bg-foreground text-background rounded-md font-semibold inline-flex items-center gap-1"
              >
                Continue <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </>
        )}
      </BubbleCard>

      {/* Step 2 — Open /live */}
      <BubbleCard
        active={step === "openLive"}
        done={["drag", "testPattern", "fullscreen", "save"].includes(step)}
        icon={ExternalLink}
        what="Open the projector window in a new browser tab"
        why="PresentFlow separates the operator screen (what you see) from the projector screen (what the congregation sees). This lets you edit and preview safely without anything reaching the projector until you press SEND TO LIVE."
      >
        {step === "openLive" && (
          <>
            <button
              onClick={() => {
                // Prefer Electron IPC when running inside the desktop app.
                if (typeof window !== "undefined" && window.electronAPI) {
                  void window.electronAPI.screens.spawn("Projector");
                } else {
                  window.open("/live", "presentflow-projector", "noopener");
                }
                setStep("drag");
              }}
              className="h-9 px-3 text-xs bg-foreground text-background rounded-md font-semibold inline-flex items-center gap-1"
            >
              Open projector window <ExternalLink className="w-3 h-3" />
            </button>
            <p className="text-xs text-muted-foreground mt-2">
              A new window opens with a mostly-black screen. That’s the projector output. Don’t close it — you’re about to move it.
            </p>
          </>
        )}
      </BubbleCard>

      {/* Step 3 — Drag to projector */}
      <BubbleCard
        active={step === "drag"}
        done={["testPattern", "fullscreen", "save"].includes(step)}
        icon={Monitor}
        what="Drag the new window onto the projector"
        why="macOS and Windows put every new window on the main display by default. You have to drag it to the projector before it becomes visible to the congregation."
      >
        {step === "drag" && (
          <>
            <ol className="text-sm space-y-1 list-decimal pl-5">
              <li>Click and hold the top bar of the projector window.</li>
              <li>Drag it toward the projector (usually to the right or above).</li>
              <li>Let go once it’s fully on the other display.</li>
            </ol>
            <button
              onClick={() => setStep("testPattern")}
              className="h-9 px-3 text-xs bg-foreground text-background rounded-md font-semibold mt-3"
            >
              Done, it’s on the projector
            </button>
          </>
        )}
      </BubbleCard>

      {/* Step 4 — Test pattern */}
      <BubbleCard
        active={step === "testPattern"}
        done={["fullscreen", "save"].includes(step)}
        icon={CheckCircle2}
        what="Send a test pattern to the projector"
        why="Before Sunday, we want to know the pixel path works: operator → projector → wall. If the test pattern is crisp and full-frame, so will your slides be."
      >
        {step === "testPattern" && (
          <>
            <button
              onClick={() => {
                // Post a test-pattern instruction over BroadcastChannel — /live listens
                const ch = new BroadcastChannel("presentflow-live");
                ch.postMessage({
                  type: "set",
                  slide: { kind: "text", text: "TEST PATTERN\n\n✓ If you can read this on the projector,\nthe operator → projector path works.\n\nPress SPACE to advance." },
                });
                setTimeout(() => ch.close(), 500);
                toast.success("Test pattern sent — check the projector");
                setTestPatternConfirmed(true);
              }}
              className="h-9 px-3 text-xs bg-foreground text-background rounded-md font-semibold"
            >
              Send test pattern
            </button>
            {testPatternConfirmed && (
              <div className="mt-3 space-y-2">
                <p className="text-sm">Do you see the test pattern on the projector?</p>
                <div className="flex gap-2">
                  <button onClick={() => setStep("fullscreen")}
                    className="h-9 px-3 text-xs bg-success/10 border border-success text-success rounded-md font-semibold">
                    Yes, I see it
                  </button>
                  <button
                    onClick={() => {
                      setTestPatternConfirmed(false);
                      toast.info("Check: is the /live window on the correct display? Try dragging again.");
                    }}
                    className="h-9 px-3 text-xs border border-border rounded-md">
                    No, I don’t
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </BubbleCard>

      {/* Step 5 — Fullscreen */}
      <BubbleCard
        active={step === "fullscreen"}
        done={step === "save"}
        icon={Maximize2}
        what="Fullscreen the projector window"
        why="Fullscreen removes the browser chrome (address bar, tabs) so nothing but your slides shows on the wall. You can also double-click the projector window as a shortcut."
      >
        {step === "fullscreen" && (
          <>
            <p className="text-sm">
              Click on the projector window (to give it focus), then press <kbd className="font-mono bg-muted px-1.5 py-0.5 rounded-sm">F</kbd> — or double-click it.
              You should see the test pattern fill the whole projector.
            </p>
            <button onClick={() => setStep("save")}
              className="h-9 px-3 text-xs bg-foreground text-background rounded-md font-semibold mt-3">
              Fullscreen looks good
            </button>
          </>
        )}
      </BubbleCard>

      {/* Step 6 — Save preset */}
      <BubbleCard
        active={step === "save"}
        done={false}
        icon={CheckCircle2}
        what="Give this projector a name"
        why="Next Sunday you (or a different volunteer) can pick the same preset and skip the setup steps. Names like “Main sanctuary”, “Youth hall”, “Sunday School” work well."
      >
        {step === "save" && (
          <>
            <input
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
              placeholder="e.g. Main sanctuary projector"
              className="w-full max-w-sm h-9 px-3 text-sm border border-border rounded-md bg-background"
            />
            <button
              onClick={() => {
                const label = venueName.trim() || "Default projector";
                try {
                  const existing = JSON.parse(localStorage.getItem("ff.projectors") || "[]");
                  const now = new Date().toISOString();
                  existing.push({ label, savedAt: now, screenCount });
                  localStorage.setItem("ff.projectors", JSON.stringify(existing));
                  localStorage.setItem("ff.projector.lastLabel", label);
                } catch { /* ignore */ }
                toast.success(`Saved “${venueName.trim() || "Default projector"}”. Setup complete.`);
              }}
              className="h-9 px-3 text-xs bg-foreground text-background rounded-md font-semibold ml-2"
            >
              Save & finish
            </button>
          </>
        )}
      </BubbleCard>
    </div>
  );
}

// -----------------------------------------------------------------
// Reusable bubble card w/ WHAT + WHY structure
// -----------------------------------------------------------------
function BubbleCard({ active, done, icon: Icon, what, why, children }: {
  active: boolean; done: boolean; icon: typeof Monitor;
  what: string; why: string; children?: React.ReactNode;
}) {
  return (
    <div className={`border rounded-lg p-4 transition-opacity ${done ? "opacity-60" : ""} ${active ? "border-brand shadow-sm" : "border-border"}`}
      style={{ background: active ? "var(--color-card)" : "transparent" }}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-8 h-8 rounded-md border flex items-center justify-center ${active ? "border-brand text-brand" : "border-border text-muted-foreground"}`}>
          {done ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Icon className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{what}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{why}</div>
          {active && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </div>
  );
}

function Progress({ step }: { step: StepKey }) {
  const order: StepKey[] = ["detect", "openLive", "drag", "testPattern", "fullscreen", "save"];
  const idx = order.indexOf(step);
  return (
    <div className="flex items-center gap-1">
      {order.map((k, i) => (
        <div key={k}
          className={`h-1 flex-1 rounded-full ${i < idx ? "bg-success" : i === idx ? "bg-brand" : "bg-border"}`} />
      ))}
    </div>
  );
}
