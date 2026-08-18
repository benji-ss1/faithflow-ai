import type { Metadata } from "next";
import LegalPage, { type LegalSection } from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Use — PresentFlow",
  description: "The terms that govern your use of the PresentFlow website and beta application.",
};

const SECTIONS: LegalSection[] = [
  {
    heading: "Agreement",
    paragraphs: [
      'By using this website (presentflow.org) or submitting a beta application, you agree to these terms. If you do not agree, please do not use the site. In these terms, "PresentFlow", "we", and "us" mean the makers of PresentFlow, and "you" means the person or church using the site.',
    ],
  },
  {
    heading: "The beta",
    paragraphs: [
      "PresentFlow is in active development. Access is limited (Wave I is a small pilot cohort of churches) and is offered free of charge during the beta. Features may change, and the beta may be updated, paused, or discontinued at any time without notice.",
    ],
  },
  {
    heading: "Applying",
    paragraphs: [
      "When you apply, please give accurate information. Submitting an application does not guarantee acceptance into the beta — we review applications and invite churches as capacity allows.",
    ],
  },
  {
    heading: "Acceptable use",
    paragraphs: [
      "You agree not to misuse the site. In particular, you agree not to:",
      { list: [
        "attempt to disrupt, attack, or gain unauthorised access to the site or its systems;",
        "submit false, spam, or automated applications;",
        "scrape, copy, or resell the site's content or design; or",
        "use the site in any way that breaks the law.",
      ] },
    ],
  },
  {
    heading: "Intellectual property",
    paragraphs: [
      "The PresentFlow name, logo, website, designs, and software are owned by us and protected by law. Nothing on this site grants you any right to use them beyond normally viewing and interacting with the site.",
    ],
  },
  {
    heading: "No warranty",
    paragraphs: [
      'The site and the beta are provided "as is" and "as available", without warranties of any kind, whether express or implied. We do not guarantee that the site will be uninterrupted, error-free, or fit for a particular purpose.',
    ],
  },
  {
    heading: "Limitation of liability",
    paragraphs: [
      "To the fullest extent permitted by law, PresentFlow will not be liable for any indirect, incidental, or consequential loss arising from your use of the site or the beta. Nothing in these terms limits any liability that cannot be limited by law.",
    ],
  },
  {
    heading: "Privacy",
    paragraphs: [
      'Your use of the site is also governed by our <a href="/privacy">Privacy Policy</a>, which explains how we handle your information.',
    ],
  },
  {
    heading: "Governing law",
    paragraphs: [
      "These terms, and any dispute arising from them or from your use of the site, are governed by the laws of Ireland, and the courts of Ireland will have exclusive jurisdiction. If you use the site from elsewhere, you remain responsible for complying with your own local laws.",
    ],
  },
  {
    heading: "Changes",
    paragraphs: [
      "We may update these terms as PresentFlow grows. When we do, we will change the date at the top of this page. Continuing to use the site means you accept the updated terms.",
    ],
  },
  {
    heading: "Contact",
    paragraphs: [
      'Questions about these terms? Email <a href="mailto:contact@presentflow.org">contact@presentflow.org</a>.',
    ],
  },
];

export default function Page() {
  return (
    <LegalPage
      kicker="Legal · Terms"
      title="Terms of Use"
      effective="Effective 18 August 2026"
      intro="These terms cover your use of the PresentFlow website and beta application. They're written to be clear rather than clever."
      sections={SECTIONS}
      footNote="These terms are provided in good faith for the PresentFlow beta and are not legal advice. Have them reviewed by a qualified professional before relying on them."
    />
  );
}
