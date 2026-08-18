import type { Metadata } from "next";
import LegalPage, { type LegalSection } from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Data Processing Agreement — PresentFlow",
  description: "How PresentFlow processes personal data on behalf of churches under UK/EU data protection law.",
};

const SECTIONS: LegalSection[] = [
  {
    heading: "About this agreement",
    paragraphs: [
      'This Data Processing Agreement ("DPA") forms part of the agreement between PresentFlow ("we", "us", the processor) and the church or organisation using PresentFlow ("you", the controller). It sets out how we process personal data on your behalf under UK GDPR and, where applicable, EU GDPR. If you need a countersigned copy for your records, email <a href="mailto:contact@presentflow.org">contact@presentflow.org</a>. <em>[Have this reviewed and, if required, formally executed with your legal adviser.]</em>',
    ],
  },
  {
    heading: "Roles",
    paragraphs: [
      "You are the data controller: you decide what personal data is put into PresentFlow and why. We are the data processor: we process that data only to provide the service to you, and only on your documented instructions (including through your use of the product's features).",
    ],
  },
  {
    heading: "Scope, nature and purpose",
    paragraphs: [
      "We process personal data solely to operate PresentFlow for you — running services, presenting lyrics and scripture, detecting speech, storing your songs, media, plans and settings, and providing support. The duration of processing matches the term of your use of PresentFlow, plus any short retention period described below.",
    ],
  },
  {
    heading: "Categories of data",
    paragraphs: [
      "Depending on how you use PresentFlow, we may process:",
      { list: [
        "Account and team data — names, email addresses, roles, and login credentials (passwords are stored only as salted hashes);",
        "Operational content — service plans, songs, slides, media, and settings you create;",
        "Audio-derived data — transcripts and detections produced while a service is running; and",
        "Technical data — IP address, device/session information, and diagnostic logs.",
      ] },
      "The data subjects are typically your team members and volunteers who use the product. PresentFlow is not designed to collect congregation members' personal data.",
    ],
  },
  {
    heading: "Our obligations",
    paragraphs: [
      "We will:",
      { list: [
        "process personal data only on your instructions and for the purposes above;",
        "ensure people authorised to process the data are bound by confidentiality;",
        "keep appropriate technical and organisational security measures (see below);",
        "assist you, so far as reasonably possible, in meeting your own obligations — including responding to data-subject requests and to security incidents; and",
        "make available the information you reasonably need to demonstrate compliance.",
      ] },
    ],
  },
  {
    heading: "Security measures",
    paragraphs: [
      "We protect personal data with measures appropriate to the risk, including:",
      { list: [
        "encryption in transit (HTTPS/TLS everywhere) and access over secure connections;",
        "tenant isolation so each church's data is scoped to that church;",
        "row-level security enabled on the database and secret keys held only server-side;",
        "hashed passwords, authenticated and rate-limited access, and audit logging; and",
        "error monitoring and regular review of our security posture.",
      ] },
    ],
  },
  {
    heading: "Sub-processors",
    paragraphs: [
      "We use a small number of trusted providers to run PresentFlow — currently our hosting and database provider (Supabase), our application host (Vercel), our audio-processing bridge, our transcription provider (Deepgram), our AI provider (Groq), our email provider (Resend), our analytics/monitoring providers (PostHog, Sentry), and, for paid plans, our payment processor (Stripe). We remain responsible for their processing, require appropriate data-protection terms from each, and will give you a way to be informed of changes so you can object. <em>[Confirm this sub-processor list stays current before relying on it.]</em>",
    ],
  },
  {
    heading: "International transfers",
    paragraphs: [
      "We aim to host church data in the UK/EU region. Where a sub-processor processes data outside the UK/EU, we rely on an appropriate transfer mechanism (such as UK/EU Standard Contractual Clauses or an adequacy decision). <em>[Confirm the transfer mechanism for each provider with your adviser.]</em>",
    ],
  },
  {
    heading: "Data-subject requests and breaches",
    paragraphs: [
      "If we receive a request from one of your data subjects, we will forward it to you rather than respond directly, unless legally required to. If we become aware of a personal-data breach affecting your data, we will notify you without undue delay and give you the information you need to meet your own notification obligations.",
    ],
  },
  {
    heading: "Return and deletion",
    paragraphs: [
      "On termination, or at your request, we will delete or return the personal data we process for you, and delete existing copies, unless we are required by law to keep it. Backups are cycled out on our normal retention schedule.",
    ],
  },
  {
    heading: "Audits",
    paragraphs: [
      "We will make available the information reasonably necessary to demonstrate compliance with this DPA and will co-operate with reasonable audit requests, subject to appropriate notice, confidentiality, and not disrupting the service of other churches.",
    ],
  },
  {
    heading: "Contact",
    paragraphs: [
      'For any data-protection question, or to request a signed DPA, email <a href="mailto:contact@presentflow.org">contact@presentflow.org</a>.',
    ],
  },
];

export default function Page() {
  return (
    <LegalPage
      kicker="Legal · Data Processing"
      title="Data Processing Agreement"
      effective="Effective 18 August 2026"
      intro="How PresentFlow processes personal data on your church's behalf under UK/EU data protection law. Written to be clear rather than clever."
      sections={SECTIONS}
      footNote="This DPA is provided in good faith for the PresentFlow beta and is not legal advice. Have it reviewed — and, where your organisation requires, formally executed — by a qualified professional before relying on it."
    />
  );
}
