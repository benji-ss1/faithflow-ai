import type { Metadata } from "next";
import LegalPage, { type LegalSection } from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — PresentFlow",
  description: "How PresentFlow collects, uses, and protects your information on this website and beta application.",
};

const SECTIONS: LegalSection[] = [
  {
    heading: "Who we are",
    paragraphs: [
      'PresentFlow ("PresentFlow", "we", "us") builds AI-native presentation software for churches. This policy explains how we handle personal information collected through this website (presentflow.org) and our beta application form.',
      'If you have any questions, contact us at <a href="mailto:contact@presentflow.org">contact@presentflow.org</a>.',
    ],
  },
  {
    heading: "Information we collect",
    paragraphs: [
      "<strong>Information you give us.</strong> When you apply for the beta, we collect what you enter in the form — your church name and location, your name, your email address, and your answers about your current setup, tools, and workflow.",
      "<strong>Information collected automatically.</strong> When you visit the site we collect basic usage analytics through PostHog — for example pages viewed, interactions, approximate location derived from your IP address, and device/browser type. Some of this is stored using cookies and your browser's local storage.",
      "We deliberately collect the minimum we need. We do not ask for payment details on this site, and the beta is free.",
    ],
  },
  {
    heading: "How we use your information",
    paragraphs: [
      { list: [
        "To review your beta application and decide on Wave I invitations.",
        "To contact you about your application and the beta.",
        "To understand how the site is used and improve the product and this website.",
        "To keep the site secure and prevent abuse (for example, rate-limiting the application form).",
      ] },
    ],
  },
  {
    heading: "Legal basis (UK/EU GDPR)",
    paragraphs: [
      "Where UK or EU data protection law applies, we rely on your <strong>consent</strong> when you submit the application form, and on our <strong>legitimate interests</strong> in running the beta, keeping the site secure, and measuring how it is used. You can withdraw consent at any time by contacting us.",
    ],
  },
  {
    heading: "Who we share it with",
    paragraphs: [
      "We do not sell your personal information. We share it only with service providers who process it on our behalf so we can operate:",
      { list: [
        "<strong>Resend</strong> — to deliver application and confirmation emails.",
        "<strong>PostHog</strong> — product and website analytics.",
        "<strong>Vercel</strong> — website hosting and infrastructure.",
      ] },
      "These providers process data under their own terms and appropriate data-protection agreements.",
    ],
  },
  {
    heading: "Cookies and analytics",
    paragraphs: [
      "We use cookies and local storage for analytics (via PostHog) and to remember your progress through the application form so you can resume it. You can block or delete cookies in your browser settings; the site will still work, though your form progress may not be saved.",
    ],
  },
  {
    heading: "How long we keep it",
    paragraphs: [
      "We keep application data for as long as we need it to run the beta and follow up with applicants, and analytics data for a limited period to understand trends. You can ask us to delete your information at any time and we will do so unless we are required to keep it.",
    ],
  },
  {
    heading: "International transfers",
    paragraphs: [
      "Some of our providers are based in the United States, so your information may be processed outside your country. Where required, we rely on appropriate safeguards (such as standard contractual clauses) for these transfers.",
    ],
  },
  {
    heading: "Your rights",
    paragraphs: [
      "Depending on where you live, you may have the right to access, correct, delete, or export your personal information, to object to or restrict certain processing, and to withdraw consent. To exercise any of these, email <a href=\"mailto:contact@presentflow.org\">contact@presentflow.org</a>. If you are in the UK or EU, you also have the right to complain to your local data protection authority.",
    ],
  },
  {
    heading: "Security",
    paragraphs: [
      "We serve the site over HTTPS, limit who can access application data, and collect as little as possible. No system is perfectly secure, but we take reasonable steps to protect your information.",
    ],
  },
  {
    heading: "Children",
    paragraphs: [
      "This site and the beta are intended for adults acting on behalf of a church or ministry. It is not directed at children.",
    ],
  },
  {
    heading: "Changes to this policy",
    paragraphs: [
      "We may update this policy as PresentFlow grows. When we do, we will change the date at the top of this page.",
    ],
  },
];

export default function Page() {
  return (
    <LegalPage
      kicker="Legal · Privacy"
      title="Privacy Policy"
      effective="Effective 18 August 2026"
      intro="Your trust matters to us. This policy explains, in plain language, what we collect on this website and beta application, why, and the choices you have."
      sections={SECTIONS}
      footNote="This policy is provided in good faith for the PresentFlow beta and is not legal advice. Have it reviewed by a qualified professional before relying on it."
    />
  );
}
