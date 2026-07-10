# Parser Fixtures

Every fixture in this tree is **CONSTRUCTED BY HAND** for tests. None of
these are real exports from the respective apps. They match the format
shape as we understand it from public docs and community reverse-
engineering — good enough to prove the parser accepts the shape, but not
a substitute for testing against genuine exports before shipping to
production.

## What's here

| Path | Represents | Real-world source? |
|------|-----------|--------------------|
| `propresenter/sample.pro6` | A minimal `RVPresentationDocument` XML | Hand-crafted, matches Pro6 XML shape (attributes for title/artist, `<RVTextElement plainText>` for slide bodies). |
| `csv/sample.csv` | A two-song CSV in `title,artist,slide1,slide2` shape | Hand-crafted, matches our own CSV convention (documented in `../../src/lib/parsers/csv.ts`). |
| `openlp/README.md` | Instructions for the OpenLP fixture (generated at test time) | The `.osz` is a ZIP; we build it in-memory in `parsers.test.ts` rather than committing a binary. Inner XML is OpenLyrics 0.9. |
| `proclaim/README.md` | Instructions for the Proclaim fixture (generated at test time) | The `.zip` is generated in-memory in `parsers.test.ts`. Inner JSON matches best-effort field names. |
| `easyworship/README.md` | Notes explaining why we cannot ship a fixture | EasyWorship uses Firebird — cannot fake convincingly without a native driver. |

## What's NOT here

- **MediaShout** and **WorshipTools**: proprietary binary formats with no
  public spec. Attempting to fabricate a fixture would be misleading.
  The parsers are detection-only stubs; the tests assert their stub
  behaviour directly rather than parsing files.
