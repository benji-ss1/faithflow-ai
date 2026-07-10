/**
 * Bible translation provenance registry.
 *
 * Each entry documents the legal and textual provenance for a translation
 * bundled with FaithFlow. Public-domain entries are safe to distribute the
 * full verse text; licensed entries MUST NOT have verse rows populated in
 * `bible_verses` and are surfaced only as locked slots in the UI.
 *
 * Keep this file the single source of truth for provenance blurbs shown
 * anywhere in the product (Bible library, Settings > Translations, etc.).
 */

export type Provenance = {
  code: string;
  name: string;
  fullName: string;
  originalYear: number;
  publicDomain: boolean;
  licenseRequired: boolean;
  pdJustification: string;
  textSource: string;
  verified: "checked-against-original" | "trusted-community-typeset" | "n/a-licensed";
  caveats?: string;
  uncertain?: boolean;
};

export const BIBLE_PROVENANCE: Record<string, Provenance> = {
  KJV: {
    code: "KJV",
    name: "King James Version",
    fullName: "The Holy Bible, Authorized (King James) Version",
    originalYear: 1611,
    publicDomain: true,
    licenseRequired: false,
    pdJustification:
      "Original 1611 text is in the public domain worldwide. In the United States all pre-1928 works are PD. The UK Crown copyright applies only within the UK and only to specific editions; the underlying text used here is the standard 1769 Blayney revision which is universally treated as PD in the US and non-UK jurisdictions.",
    textSource: "Bible SuperSearch (biblesupersearch.com) public-domain corpus, cross-checked against Project Gutenberg KJV.",
    verified: "checked-against-original",
  },
  ASV: {
    code: "ASV",
    name: "American Standard Version (1901)",
    fullName: "American Standard Version of the Holy Bible",
    originalYear: 1901,
    publicDomain: true,
    licenseRequired: false,
    pdJustification:
      "Published 1901 by Thomas Nelson & Sons. Copyright expired in the United States; entered the public domain by 1957 at the latest and is universally distributed as PD today.",
    textSource: "Bible SuperSearch public-domain corpus.",
    verified: "checked-against-original",
  },
  WEB: {
    code: "WEB",
    name: "World English Bible",
    fullName: "World English Bible",
    originalYear: 2000,
    publicDomain: true,
    licenseRequired: false,
    pdJustification:
      "Explicitly released into the public domain by the eBible.org / Rainbow Missions project. Not subject to copyright anywhere.",
    textSource: "eBible.org WEB release via Bible SuperSearch.",
    verified: "checked-against-original",
    caveats: "WEB does not include a small number of verses that older translations do (e.g. 1 John 5:7 Comma Johanneum). Verse count 29,954 vs ~31,100 in KJV/ASV is expected.",
  },
  YLT: {
    code: "YLT",
    name: "Young's Literal Translation (1898)",
    fullName: "Young's Literal Translation of the Holy Bible (Revised Edition)",
    originalYear: 1898,
    publicDomain: true,
    licenseRequired: false,
    pdJustification:
      "First edition 1862; revised edition 1898 by Robert Young. Author died 1888. Text is PD worldwide by any life-plus-70 or pre-1928 rule.",
    textSource: "Bible SuperSearch public-domain corpus.",
    verified: "checked-against-original",
  },
  DARBY: {
    code: "DARBY",
    name: "Darby Bible (1890)",
    fullName: "The Holy Scriptures: A New Translation from the Original Languages by J. N. Darby",
    originalYear: 1890,
    publicDomain: true,
    licenseRequired: false,
    pdJustification:
      "John Nelson Darby died 1882; NT 1867, OT 1890. Well past any copyright term; PD worldwide.",
    textSource: "Bible SuperSearch public-domain corpus (Sword Modules cross-reference).",
    verified: "trusted-community-typeset",
    caveats: "Digital text originates from community-typeset Sword modules; minor typographical variance from Darby's original print editions is possible but content is faithful.",
  },
  DRC: {
    code: "DRC",
    name: "Douay-Rheims (Challoner Revision, 1899)",
    fullName: "Douay-Rheims Bible, Bishop Richard Challoner Revision",
    originalYear: 1752,
    publicDomain: true,
    licenseRequired: false,
    pdJustification:
      "Original Douay-Rheims 1582/1610. Bishop Challoner's revisions were completed 1749-1752. The standard 1899 John Murphy edition is the commonly circulated form. All pre-1928 and PD by any modern copyright test.",
    textSource: "Bible SuperSearch / unbound-bible public-domain corpus.",
    verified: "trusted-community-typeset",
    caveats: "Catholic canon: includes 78 books (deuterocanonicals: Tobit, Judith, Wisdom, Sirach, Baruch, 1-2 Maccabees, plus Greek additions to Esther and Daniel). Higher verse count (~37,255) is expected.",
  },
  GEN1599: {
    code: "GEN1599",
    name: "Geneva Bible (1599)",
    fullName: "The Geneva Bible, 1599 Edition",
    originalYear: 1599,
    publicDomain: true,
    licenseRequired: false,
    pdJustification:
      "Original 1560; 1599 edition well past any copyright term. Text is PD worldwide.",
    textSource: "Community-typeset Sword module / Bible SuperSearch redistribution.",
    verified: "trusted-community-typeset",
    uncertain: true,
    caveats:
      "PROVENANCE FLAG: The 1599 edition is typically distributed today as a modern re-typesetting (frequently derived from the 2006-2010 Tolle Lege Press facsimile lineage). Spelling has usually been modernised. Content is faithful to the 1599 edition but the digital text has NOT been diff-checked against a 1599 facsimile in this project. Treat as trusted-community-typeset. Legal PD status is not in question; textual fidelity to the 1599 first-edition typography is.",
  },
  // -------- Licensed slots (NO verses stored) --------
  NIV: {
    code: "NIV",
    name: "New International Version",
    fullName: "New International Version",
    originalYear: 1978,
    publicDomain: false,
    licenseRequired: true,
    pdJustification: "N/A — under active copyright.",
    textSource: "Not bundled. Requires licensing agreement with Biblica / Zondervan or an approved provider (Faithlife API, YouVersion API, or Bible Gateway API).",
    verified: "n/a-licensed",
    caveats: "No verse text is stored in FaithFlow. Slot exists so the UI can surface a locked state and licensing path.",
  },
  ESV: {
    code: "ESV",
    name: "English Standard Version",
    fullName: "English Standard Version",
    originalYear: 2001,
    publicDomain: false,
    licenseRequired: true,
    pdJustification: "N/A — under active copyright.",
    textSource: "Not bundled. Requires licensing agreement with Crossway or an approved provider (ESV.org API).",
    verified: "n/a-licensed",
    caveats: "No verse text is stored in FaithFlow.",
  },
  NKJV: {
    code: "NKJV",
    name: "New King James Version",
    fullName: "New King James Version",
    originalYear: 1982,
    publicDomain: false,
    licenseRequired: true,
    pdJustification: "N/A — under active copyright.",
    textSource: "Not bundled. Requires licensing agreement with Thomas Nelson / HarperCollins Christian Publishing or an approved provider.",
    verified: "n/a-licensed",
    caveats: "No verse text is stored in FaithFlow.",
  },
};

export const LICENSED_TRANSLATION_CODES = ["NIV", "ESV", "NKJV"] as const;
export type LicensedCode = (typeof LICENSED_TRANSLATION_CODES)[number];

export function getProvenance(code: string): Provenance | undefined {
  return BIBLE_PROVENANCE[code];
}

export function isLicensedCode(code: string): boolean {
  return (LICENSED_TRANSLATION_CODES as readonly string[]).includes(code);
}
