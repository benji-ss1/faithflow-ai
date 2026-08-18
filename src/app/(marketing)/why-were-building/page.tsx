import type { Metadata } from "next";
import WhyWereBuilding from "@/components/marketing/WhyWereBuilding";
import CtaSection from "@/components/marketing/CtaSection";

export const metadata: Metadata = {
  title: "Why we're building — PresentFlow",
  description:
    "The screen should follow the room. We're building automated emotion, starting small with fifteen churches on real Sundays.",
};

export default function Page() {
  return (
    <>
      <WhyWereBuilding />
      <CtaSection />
    </>
  );
}
