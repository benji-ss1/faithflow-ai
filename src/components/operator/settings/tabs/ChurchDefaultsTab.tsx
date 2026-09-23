"use client";
import { SectionHeader } from "./DisplayTab";
import { ChurchDefaultsCard } from "@/components/settings/ChurchDefaultsCard";

/** Operator Settings → "Church defaults" (2026-09-23). Same card as /organization. */
export function ChurchDefaultsTab() {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Church defaults"
        description="What every service starts with: Bible translation, main theme and animated background. Changes made during a service stay in that service."
      />
      <ChurchDefaultsCard compact />
    </div>
  );
}
