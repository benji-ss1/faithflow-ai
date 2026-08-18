import type { Metadata } from "next";
import LegalPage, { type LegalSection } from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Master Service Agreement — PresentFlow",
  description: "The master terms that govern paid and organisation-level use of PresentFlow.",
};

const SECTIONS: LegalSection[] = [
  {
    heading: "About this agreement",
    paragraphs: [
      'This Master Service Agreement ("MSA") sets out the terms on which PresentFlow ("we", "us") provides the PresentFlow service to a church or organisation ("you", "Customer") on a paid or organisation-level basis. It works alongside our <a href="/terms">Terms of Use</a>, <a href="/privacy">Privacy Policy</a>, <a href="/refund">Refund Policy</a>, and <a href="/dpa">Data Processing Agreement</a>. Where a signed order form or enterprise agreement conflicts with this MSA, the signed document controls. <em>[Have this reviewed by a qualified professional before relying on it.]</em>',
    ],
  },
  {
    heading: "The service",
    paragraphs: [
      "We provide PresentFlow — software for running church services, presenting lyrics and scripture, and related features — as described on our website and in any applicable plan or order form. We may improve, change, or retire individual features over time; we will not make a material reduction to a paid plan's core function without a reasonable equivalent or notice.",
    ],
  },
  {
    heading: "Plans and order forms",
    paragraphs: [
      "The specific plan, features, usage limits, and fees that apply to you are set out in the plan you select or in a signed order form. Each order form incorporates this MSA by reference.",
    ],
  },
  {
    heading: "Fees and payment",
    paragraphs: [
      "Paid plans are billed in advance on a recurring basis (monthly or yearly) through our payment processor, Stripe, unless a signed order form states otherwise. Fees are exclusive of any applicable taxes, which you are responsible for. Late or failed payment may result in suspension after reasonable notice. Refunds are handled under our <a href=\"/refund\">Refund Policy</a>.",
    ],
  },
  {
    heading: "Term, renewal and termination",
    paragraphs: [
      "This agreement runs for the term of your plan or order form and renews automatically for successive periods unless either party cancels before renewal. Either party may terminate for material breach that is not cured within a reasonable period after written notice. On termination, your right to use the service ends and we handle your data as described in the DPA.",
    ],
  },
  {
    heading: "Your responsibilities",
    paragraphs: [
      "You agree to:",
      { list: [
        "use the service in line with our Terms of Use and applicable law;",
        "keep your account credentials secure and be responsible for activity under your account;",
        "hold the rights or licences needed for any content (including song lyrics) you put into PresentFlow; and",
        "give accurate account and billing information.",
      ] },
    ],
  },
  {
    heading: "Intellectual property",
    paragraphs: [
      "We own PresentFlow, its software, designs, and brand. You own the content you create in the product. You grant us the limited licence needed to host and process that content in order to provide the service. Nothing here transfers ownership of one party's intellectual property to the other.",
    ],
  },
  {
    heading: "Confidentiality",
    paragraphs: [
      "Each party may receive non-public information from the other. Each agrees to use the other's confidential information only to perform under this agreement and to protect it with reasonable care. This does not apply to information that is public, already known, or independently developed.",
    ],
  },
  {
    heading: "Data protection",
    paragraphs: [
      'Personal data is handled under our <a href="/privacy">Privacy Policy</a> and, where we process personal data on your behalf, our <a href="/dpa">Data Processing Agreement</a>, which forms part of this MSA.',
    ],
  },
  {
    heading: "Warranties and disclaimers",
    paragraphs: [
      'We will provide the service with reasonable skill and care. Except as expressly stated, the service is provided "as is" and "as available", and we disclaim all other warranties to the fullest extent permitted by law. We do not warrant that the service will be uninterrupted or error-free.',
    ],
  },
  {
    heading: "Limitation of liability",
    paragraphs: [
      "To the fullest extent permitted by law, neither party is liable for indirect, incidental, or consequential loss, and each party's total liability arising out of this agreement is limited to the fees you paid in the 12 months before the event giving rise to the claim. Nothing limits liability that cannot be limited by law (such as death or personal injury caused by negligence, or fraud). <em>[Confirm the liability cap wording with your legal adviser.]</em>",
    ],
  },
  {
    heading: "Indemnification",
    paragraphs: [
      "You agree to indemnify us against claims arising from content you put into PresentFlow that you did not have the right to use, or from your breach of this agreement or the law. Each party's indemnity is subject to prompt notice and reasonable co-operation. <em>[Confirm mutual indemnity scope with your adviser.]</em>",
    ],
  },
  {
    heading: "Changes",
    paragraphs: [
      "We may update this MSA as PresentFlow grows. For material changes to a paid plan, we will give reasonable notice. Continuing to use the service after a change takes effect means you accept the updated terms.",
    ],
  },
  {
    heading: "Governing law",
    paragraphs: [
      "This agreement is governed by the laws of the jurisdiction in which PresentFlow operates, and disputes will be handled by the courts of that jurisdiction. <em>[Confirm the specific governing law and venue with your legal adviser.]</em>",
    ],
  },
  {
    heading: "Contact",
    paragraphs: [
      'For enterprise terms, a signed order form, or any question about this agreement, email <a href="mailto:contact@presentflow.org">contact@presentflow.org</a>.',
    ],
  },
];

export default function Page() {
  return (
    <LegalPage
      kicker="Legal · Master Service Agreement"
      title="Master Service Agreement"
      effective="Effective 18 August 2026"
      intro="The master terms for paid and organisation-level use of PresentFlow. Written to be clear rather than clever."
      sections={SECTIONS}
      footNote="This MSA is provided in good faith for the PresentFlow beta and is not legal advice. Have it reviewed — and, for enterprise use, tailored — by a qualified professional before relying on it."
    />
  );
}
