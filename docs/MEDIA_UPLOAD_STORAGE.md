# Media uploads — storage prerequisites (2026-09-16)

Bucket config is NOT in this repo. Apply these on the S3-compatible bucket
(`S3_BUCKET`) before relying on large-video uploads.

## 1. CORS — must expose `ETag`

Multipart uploads read each part's `ETag` response header in the browser. If it
isn't exposed the client stops with: "Large uploads aren't set up on the
storage server yet…" (files ≤100 MB keep using the single-PUT path and are
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
(and `HEAD` if missing). Verify with a browser upload of a >100 MB video.

## 2. Lifecycle — abort incomplete multipart uploads

Parts from a closed tab / crashed upload are billable until aborted. Add:

```json
{ "Rules": [{ "ID": "abort-incomplete-mpu", "Status": "Enabled", "Filter": {},
  "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 } }] }
```

## 3. Server credentials

`registerMediaAsset` now HEADs the object and does a ranged GET of the first
64 bytes. The server IAM key needs `s3:GetObject` (already used for thumbnails),
`s3:DeleteObject`, and for multipart `s3:PutObject` (covers
CreateMultipartUpload/UploadPart/CompleteMultipartUpload) plus
`s3:AbortMultipartUpload`.

## 4. Audio

Apply `docs/migrations/2026-09-16-add-media-kind-audio.sql`. Until then audio
uploads are refused up front with "Audio needs a quick update — coming soon".

## Not done (follow-up)

- Per-church storage quota: there is no existing storage plan/limit concept
  (only song limits), so none was invented. Needs a product decision.
