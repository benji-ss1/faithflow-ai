import type { Metadata } from "next";
import LegalPage, { type LegalSection } from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Refund Policy — PresentFlow",
  description: "How refunds and cancellations work for PresentFlow subscriptions.",
};

const SECTIONS: LegalSection[] = [
  {
    heading: "During the beta",
    paragraphs: [
      "PresentFlow is currently offered free of charge during the beta (Wave I). There is nothing to pay and therefore nothing to refund. This policy sets out how refunds will work once paid plans are available.",
    ],
  },
  {
    heading: "Subscriptions",
    paragraphs: [
      "When paid plans launch, PresentFlow is billed as a recurring subscription (monthly or yearly) through our payment processor, Stripe. Your plan renews automatically at the end of each billing period until you cancel.",
    ],
  },
  {
    heading: "Cancelling",
    paragraphs: [
      "You can cancel at any time from your account settings, or by emailing us. When you cancel, your subscription stays active until the end of the period you have already paid for, and it will not renew after that. We do not automatically pro-rate or refund the unused part of a period unless required by law or stated below.",
    ],
  },
  {
    heading: "14-day cooling-off",
    paragraphs: [
      "If you are a consumer in the UK or EU, you may have a statutory right to cancel a new paid subscription within 14 days of purchase for a refund. Because PresentFlow is a digital service you start using immediately, this right may not apply once you have begun using a paid plan — we will honour any refund we are legally required to give. <em>[Confirm the exact cooling-off wording with your legal adviser for your jurisdiction.]</em>",
    ],
  },
  {
    heading: "When we will refund",
    paragraphs: [
      "We want PresentFlow to be worth it. We will consider a refund where:",
      { list: [
        "you were charged in error, or charged twice for the same period;",
        "a paid feature was unavailable for a sustained period due to a fault on our side; or",
        "the law entitles you to one.",
      ] },
      "Refunds are issued to your original payment method via Stripe and can take a few business days to appear.",
    ],
  },
  {
    heading: "When we usually won't",
    paragraphs: [
      "We generally do not refund:",
      { list: [
        "a period that has already been used;",
        "a renewal you forgot to cancel before it billed (though we'll always look at these case by case); or",
        "charges where the service worked as described.",
      ] },
    ],
  },
  {
    heading: "How to request a refund",
    paragraphs: [
      'Email <a href="mailto:contact@presentflow.org">contact@presentflow.org</a> from the address on your account, with your church name and the charge date. We aim to respond within a few business days.',
    ],
  },
  {
    heading: "Changes",
    paragraphs: [
      "We may update this policy as PresentFlow grows and paid plans go live. When we do, we will change the date at the top of this page.",
    ],
  },
  {
    heading: "Contact",
    paragraphs: [
      'Questions about billing or refunds? Email <a href="mailto:contact@presentflow.org">contact@presentflow.org</a>.',
    ],
  },
];

export default function Page() {
  return (
    <LegalPage
      kicker="Legal · Refunds"
      title="Refund Policy"
      effective="Effective 18 August 2026"
      intro="How refunds and cancellations work for PresentFlow. Written to be clear rather than clever."
      sections={SECTIONS}
      footNote="This policy is provided in good faith for the PresentFlow beta and is not legal advice. Have it reviewed by a qualified professional before relying on it, especially the consumer cancellation wording for your jurisdiction."
    />
  );
}
