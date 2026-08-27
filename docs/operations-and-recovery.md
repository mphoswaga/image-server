# LessonScope Operations and Recovery

## Runtime visibility

LessonScope writes one JSON object per request to standard output. Railway can
search these records by `requestId`, `event`, `status`, or `category`.
Responses include the same request ID in `X-Request-ID`, so a teacher-reported
failure can be matched to its server log.

The logger records route templates, status, latency, and response size. It does
not record request bodies, query strings, cookies, authorization headers,
student answers, or uploaded document contents. Likely token, password, secret,
and API-key values are redacted from explicit error fields.

Operational endpoints:

- `GET /healthz`: confirms the process is running and identifies its commit.
- `GET /readyz`: confirms `DATA_DIR` is readable and writable and that minimum
  free storage is available. Railway should use this as the readiness check.
- `GET /api/admin/operations`: admin-only counters for request status, latency,
  AI/export/upload/wallet failures, readiness, and the running commit.

`MIN_FREE_STORAGE_BYTES` controls the readiness threshold and defaults to
104,857,600 bytes (100 MB).

## Recommended alerts

Configure Railway or an external monitor to alert on:

- `/readyz` returning `503`.
- Repeated `http.request` records with a status of `500` or higher.
- Repeated `operation.failed` records, grouped by `category`.
- `storage.ok` becoming false or available storage approaching the threshold.
- Wallet and Lemon Squeezy webhook failures.
- Unexpected changes in AI usage or spend from the provider dashboard.

The repository does not contain a monitoring-provider key. Connect Sentry,
Better Stack, Datadog, or another provider later if exception notifications are
required outside Railway. Never put its secret or DSN into source control.

## Create and verify a backup

Backups must be stored outside `DATA_DIR`; keeping a backup on the same volume
does not protect against volume loss. Choose an empty destination:

```bash
DATA_DIR=/data npm run backup -- /backups/lessonscope-2026-08-27-1200
npm run backup:verify -- /backups/lessonscope-2026-08-27-1200
```

Each snapshot contains `data/` and `manifest.json`. The manifest lists every
file, byte size, and SHA-256 checksum. Temporary `.tmp` files are excluded.
Verification fails if a file is missing, added, resized, or changed.

Automate this command daily while JSON/file storage remains the production
system of record, then copy the completed verified directory to encrypted
offsite storage. Keep at least seven daily and four weekly snapshots, subject to
the school's retention and student-data policy.

## Restore drill

Never restore directly over a live, populated `/data` directory.

1. Stop writes or place the app in maintenance mode.
2. Verify the selected backup.
3. Restore into a new empty directory or volume.
4. Start a non-production instance with `DATA_DIR` pointing to the restored
   directory.
5. Confirm login, templates, rosters, assignments, and practice reports.
6. Switch production only after those checks pass; retain the previous volume
   until the observation period ends.

Example non-production drill:

```bash
npm run backup:verify -- /backups/lessonscope-2026-08-27-1200
npm run restore -- /backups/lessonscope-2026-08-27-1200 /tmp/lessonscope-restore-test
DATA_DIR=/tmp/lessonscope-restore-test NODE_ENV=production PORT=4333 npm start
```

The restore command refuses a backup with invalid checksums and refuses to
write into a non-empty target.

## Incident checklist

1. Capture the teacher's time, action, and displayed request ID.
2. Confirm `/healthz`, `/readyz`, and the deployed commit.
3. Search Railway logs for the request ID.
4. Check `/api/admin/operations` for the affected failure category.
5. Check the relevant dependency: OpenAI, EducScope wallet, Google export, or
   persistent storage.
6. Preserve logs and take a verified backup before destructive recovery work.
7. Roll back the code only when the failure aligns with a recent deployment;
   never overwrite current data with an old snapshot merely to roll back code.
