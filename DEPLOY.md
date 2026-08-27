# Deploying LessonCope to Railway

The Railway project already exists: **protective-bravery → service `image-server`**,
deploying from GitHub `mphoswaga/image-server`, live at
`https://image-server-production-2a4c.up.railway.app`.

These steps take it from the old "initial image server" code to the full app,
with data that survives redeploys.

## 1. Push the app code

The whole LessonCope app is committed locally but the GitHub repo still has the
old static server. Push it (this auto-triggers a Railway deploy):

```bash
git push origin main
```

## 2. Set environment variables (Railway dashboard → Variables, or CLI)

| Variable             | Value                                                        |
| -------------------- | ----------------------------------------------------------- |
| `OPENAI_API_KEY`     | your OpenAI key (required)                                   |
| `UNSPLASH_ACCESS_KEY`| your Unsplash key (optional — enables photo fetching)        |
| `SESSION_SECRET`     | a long random string (see below)                            |
| `ADMIN_EMAIL`        | `mphoeduc@gmail.com`                                         |
| `DATA_DIR`           | `/data`                                                      |

### Security controls

The security defaults are active automatically in production. These variables
are optional tuning controls; leave them unset for the tested defaults.

| Variable | Default | Purpose |
| --- | ---: | --- |
| `SECURITY_RATE_LIMITS_ENABLED` | `true` in production | Emergency master switch for request throttling. |
| `AUTH_RATE_LIMIT` | `40` per 15 minutes | Login, signup, password-reset, and passkey attempts per IP. |
| `JOIN_RATE_LIMIT` | `80` per 5 minutes | Student login, room join, PIN-reset, and activity entry attempts per IP. |
| `CHECKPOINT_RATE_LIMIT` | `300` per minute | Live-practice checkpoints per IP. |
| `GENERATION_RATE_LIMIT` | `40` per 5 minutes | AI, assistant, pack, slide, and lesson generation requests per IP. |
| `UPLOAD_RATE_LIMIT` | `30` per 5 minutes | Uploaded templates, planning sources, materials, slides, and rosters per IP. |
| `COOKIE_SECURE` | `true` in production | Override only for unusual local/proxy troubleshooting. |
| `MIN_FREE_STORAGE_BYTES` | `104857600` | Makes readiness fail before the persistent volume is completely full. |

Uploaded files are limited to 15 MB each. Multi-file source-material uploads
are also capped at 30 MB combined, and Office archives are rejected when their
declared expansion exceeds 80 MB or 5,000 entries.

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Via CLI instead of the dashboard:

```bash
railway variables --set OPENAI_API_KEY=sk-... --set SESSION_SECRET=... \
  --set ADMIN_EMAIL=mphoeduc@gmail.com --set DATA_DIR=/data
```

## 3. Add a persistent volume

Railway's container filesystem is wiped on every deploy. Mount a volume so
accounts and uploaded templates persist:

1. Railway dashboard → service `image-server` → **Variables/Settings → Volumes → New Volume**.
2. Mount path: **`/data`** (must match `DATA_DIR`).
3. Redeploy.

The app already points all account/template storage at `DATA_DIR`, so once the
volume is mounted the data is durable.

## 4. Verify

- `https://<your-url>/healthz` returns `{"ok":true,...}` → the app booted.
- `https://<your-url>/readyz` returns `{"ok":true,...}` → persistent storage is writable and has enough free space.
- Open the URL, sign up with `mphoeduc@gmail.com` → you get the admin role.
- Upload a template, generate a lesson plan + deck.

The admin-only `GET /api/admin/operations` endpoint reports request, latency,
failure-category, readiness, and deployed-commit information. Structured JSON
request logs include an `X-Request-ID` correlation value without logging request
bodies or student answers.

## 5. Backups and recovery

While `/data` remains the system of record, create a verified snapshot outside
that volume and copy it to encrypted offsite storage:

```bash
DATA_DIR=/data npm run backup -- /backups/lessonscope-YYYYMMDD-HHMMSS
npm run backup:verify -- /backups/lessonscope-YYYYMMDD-HHMMSS
```

Do not restore over live data. The tested restore command requires an empty
target. The full procedure, retention recommendation, alert checklist, and
incident workflow are in [docs/operations-and-recovery.md](docs/operations-and-recovery.md).

## Known limitation (next upgrade)

Runtime-**generated** images (AI images, fetched Unsplash photos, on-demand SVG
diagrams) are still written under `public/` and are NOT on the volume, so the
"reuse across redeploys" cache resets on each deploy. This does **not** break
generation — every deck regenerates its own images on demand. To make the
generated-image library durable, point image output at `DATA_DIR/generated` and
serve that folder (a focused follow-up). The 1,028-image curated library ships
in the repo and is always available.

For scale beyond a handful of teachers, graduate user/template storage from JSON
files to Postgres (Railway provides a one-click Postgres plugin) and move images
to object storage (S3 / Cloudinary).

## Dependency risk note

Run `npm audit --omit=dev` as part of release review. The application upgrades
all safely fixable dependencies, but the npm `xlsx` package and transitive
parsers used by ExcelJS/PptxGenJS currently report advisories without a
compatible automatic fix. Do not use `npm audit fix --force`: it proposes old,
breaking versions of the document libraries. Upload signature, archive-size,
file-size, and request-rate checks reduce exposure while spreadsheet parsing is
migrated or isolated in the next security iteration.
