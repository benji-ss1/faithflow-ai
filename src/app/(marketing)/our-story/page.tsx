import type { Metadata } from "next";
import OurStory from "@/components/marketing/OurStory";
import CtaSection from "@/components/marketing/CtaSection";

export const metadata: Metadata = {
  title: "Our Story — PresentFlow",
  description:
    "The house of God was waiting on a keyboard. A software builder and a church tech director came together to let AI keep the screen up with the room.",
};

export default function Page() {
  return (
    <>
      <OurStory />
      <CtaSection />
    </>
  );
}
