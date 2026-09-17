# Media uploads — storage prerequisites (2026-09-16)

Bucket config is NOT in this repo. Apply these on the S3-compatible bucket
(`S3_BUCKET`) before relying on large-video uploads.

## 1. CORS — must expose `ETag`

Multipart uploads read each part's `ETag` response header in the browser. If it
isn't exposed the client stops with: "Large uploads aren't set up on the
storage server yet…" (files ≤500 MB keep using the single-PUT path and are
unaffected).

```json
[
  {
    "AllowedOrigins": ["https://<production-domain>", "https://*.vercel.app", "app://presentflow", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Keep the existing `AllowedOrigins` list — only ADD `"ETag"` to `ExposeHeaders`
(and `HEAD` if missing). Verify with a browser upload of a >500 MB video.

## 2. Lifecycle — abort incomplete multipart uploads

Parts from a closed tab / crashed upload are billable until aborted. Add:

```json
{ "Rules": [{ "ID": "abort-incomplete-mpu", "Status": "Enabled", "Filter": {},
  "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 } }] }
```

The browser also sends a `navigator.sendBeacon` to `/api/media/multipart/abort`
when the tab is closed mid-upload (`pagehide`), so most orphans are released
immediately. The lifecycle rule (or cleanup job, below) is the backstop for
crashes / power loss.

## 2b. PowerPoint temp objects (`*/pptx/*.pdf` orphans)

The operator PowerPoint import (`/api/pptx/to-pdf`) writes two short-lived
objects per deck: the uploaded source `${churchId}/pptx/<uuid>.pptx|.ppt` and
the converted `${churchId}/pptx/<uuid>.pdf`. The route deletes the source when
conversion ends (unless a legacy `pptx_imports` row still references it — the
library Retry needs it) and deletes the PDF on failure; the browser DELETEs the
PDF after fetching it. A closed tab / crash between those steps leaves an
orphan PDF (up to ~1 GB). Backstop: on AWS/R2/MinIO add an expiration rule for
the `pptx/` objects ending `.pdf` older than 1 day (filters are prefix-based,
so scope per church prefix or use a bucket-wide cleanup job that matches
`^[^/]+/pptx/[0-9a-f-]{36}\.pdf$`). NEVER expire `pptx/<uuid>/slide-*.png`
(library import slides) or `.pptx` sources referenced by `pptx_imports`. On
Supabase (no lifecycle rules) this needs the same cleanup cron as §Provider
caveats — follow-up, not built.

## 3. Server credentials

`registerMediaAsset` now HEADs the object and does a ranged GET of the first
4 KB. The server IAM key needs `s3:GetObject` (already used for thumbnails),
`s3:DeleteObject`, and for multipart `s3:PutObject` (covers
CreateMultipartUpload/UploadPart/CompleteMultipartUpload),
`s3:AbortMultipartUpload`, `s3:ListBucketMultipartUploads` (per-church
concurrency cap, below) and — for any future resume support —
`s3:ListMultipartUploadParts`.

A HEAD / ranged-GET *error* (network, 5xx, throttling) never deletes an upload:
the user gets "Couldn't check the upload just now — please try again" and the
object is kept. Only bytes that were actually read and are the wrong kind
(or an out-of-bounds real size) delete the object, and never one a
`media_assets` row references.

## Provider caveats (Supabase Storage S3-compat)

- **File-size limit:** Supabase caps object size per project (Free: 50 MB;
  paid plans: configurable global limit, up to 500 GB on Pro+, set in
  Storage → Settings, and optionally per bucket). A 5 GB video fails at
  complete/PUT unless the project + bucket limit is raised. Check before
  announcing large uploads.
- **Lifecycle rules are NOT supported** by Supabase's S3-compat API. The
  `AbortIncompleteMultipartUpload` rule in §2 only applies to AWS/R2/MinIO.
  On Supabase a cleanup cron is required: ListMultipartUploads (prefix per
  church or bucket-wide) → AbortMultipartUpload for anything initiated > 24 h
  ago. (Follow-up — not built in this change.)
- **ListMultipartUploads / ListParts** support varies by provider; if listing
  fails, the per-church cap fails OPEN (see below).

## Upload limits & permissions

- `/api/media/multipart/*` require `edit_library` (same as `registerMediaAsset`).
- `/api/media/presign`: `media` → `edit_library` or `operate_services`
  (operator background uploads), `pptx` → `edit_library`, `logo` →
  `manage_church`.
- At most **5 in-progress large uploads per church** (initiated in the last
  24 h, counted via ListMultipartUploads under `${churchId}/media/`). Fails
  open if the provider can't list.
- While a slide is live, the Media Bin sends large-video parts **one at a time**
  (3 otherwise) so uploads don't starve the detection websocket / livestream.
- Deck imports register pages 4 at a time (`DECK_UPLOAD_CONCURRENCY`); each
  registration adds one indexed row lookup + HEAD + 4 KB ranged GET — no
  sequential step was added.
- Images > 25 MB skip server thumbnail generation (the original is served).

## Serving & `nosniff`

Media is not proxied through the app: `/api/media/url` returns presigned S3 GET
URLs, so `X-Content-Type-Options: nosniff` can't be set by the app on those
responses (presigned `ResponseContentType` can pin the type, not add headers).
Mitigation is upstream: SVG/HTML/script bytes are refused at registration, and
the stored Content-Type is the validated media type. If a CDN/proxy is added in
front of storage, set `nosniff` there.

## 4. Audio

Apply `docs/migrations/2026-09-16-add-media-kind-audio.sql`. Until then audio
uploads are refused up front with "Audio needs a quick update — coming soon".

## Not done (follow-up)

- Per-church storage quota: there is no existing storage plan/limit concept
  (only song limits), so none was invented. Needs a product decision.
