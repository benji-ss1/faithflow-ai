import type { Metadata } from "next";
import ApplyFlow from "@/components/marketing/ApplyFlow";

export const metadata: Metadata = {
  title: "Apply for the beta — PresentFlow",
  description:
    "The Road to Wave I — apply to join the PresentFlow closed beta. Wave one is 15 churches, free through the beta.",
};

export default function Page() {
  return <ApplyFlow />;
}
