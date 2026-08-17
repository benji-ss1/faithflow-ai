import type { Metadata } from "next";
import ApplyFlow from "@/components/marketing/ApplyFlow";

export const metadata: Metadata = {
  title: "Apply for the beta — PresentFlow",
  description: "Apply to join the PresentFlow closed beta. Wave one is 15 churches.",
};

export default function Page() {
  return <ApplyFlow />;
}
