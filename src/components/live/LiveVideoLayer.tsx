"use client";
import { useEffect, useRef, useState } from "react";
import type { VideoInputState } from "@/lib/broadcast";

/**
 * Live video input rendered full-bleed on an output surface (projector /
 * livestream), BEHIND the slide overlay. Opens its own getUserMedia stream on
 * the given deviceId so the output window shows the camera/capture feed
 * directly.
 *
 * Critical live-service behavior (spec §42/§43): the stream is keyed to
 * `deviceId` only, so it stays live across slide changes — only the overlay
 * content above it re-renders. Changing the device restarts the stream;
 * everything else leaves it running. Fully fail-safe: a denied permission,
 * missing device, or mid-service disconnect shows an explanatory state and
 * never throws / blanks the whole output.
 */
export function LiveVideoLayer({ input }: { input: VideoInputState }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "denied" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrMsg("");

    const stopStream = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setStatus("error");
          setErrMsg("Video capture isn't available here.");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          // `exact` (not `ideal`): if this id no longer resolves (device
          // reconnected with a new id), fail to the "disconnected" state and let
          // the operator re-select — NEVER silently open the machine's default
          // camera onto the projector.
          video: { deviceId: { exact: input.deviceId } },
          audio: false, // video-only for V1 — audio stays on the existing mixer
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setStatus("live");
        // Device unplugged mid-service → the track ends. Surface it, don't crash.
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          if (!cancelled) { setStatus("error"); setErrMsg("Video device disconnected."); }
        });
      } catch (e) {
        if (cancelled) return;
        const name = (e as { name?: string })?.name;
        if (name === "NotAllowedError" || name === "SecurityError") setStatus("denied");
        else {
          setStatus("error");
          setErrMsg(name === "NotFoundError" ? "Video device not found." : ((e as Error)?.message || "Couldn't start video input."));
        }
      }
    })();

    return () => { cancelled = true; stopStream(); };
  }, [input.deviceId]);

  const objectFit = input.fit === "contain" ? "contain" : input.fit === "fill" ? "fill" : "cover";

  return (
    <div className="absolute inset-0 bg-black overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit,
          transform: input.mirror ? "scaleX(-1)" : undefined,
          display: status === "live" ? "block" : "none",
        }}
      />
      {status !== "live" && (
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-white/70 text-lg font-medium">
          {status === "loading" && "Starting video…"}
          {status === "denied" && "Camera access is off. Enable it in System Settings › Privacy & Security › Camera, then reconnect the input."}
          {status === "error" && (errMsg || "No video signal.")}
        </div>
      )}
    </div>
  );
}
