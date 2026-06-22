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
- Open the URL, sign up with `mphoeduc@gmail.com` → you get the admin role.
- Upload a template, generate a lesson plan + deck.

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
