"use client";
import { useState } from "react";
import { GuidedTour } from "./GuidedTour";

/**
 * Mounts the guided tour only when the server tells us this user hasn't
 * completed it yet. Once dismissed/finished, we hide it for the rest of
 * the session (server writes tutorialCompletedAt so it also stays hidden
 * across future logins).
 */
export function TourGate({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(show);
  if (!visible) return null;
  return <GuidedTour onDone={() => setVisible(false)} />;
}
