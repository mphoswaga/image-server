# LessonCope API — Integration Guide

Base URL: `https://your-lessoncope.railway.app`

---

## Authentication

LessonCope supports two authentication methods:

| Method | For | Header |
|--------|-----|--------|
| OAuth 2.0 Bearer token | Third-party apps (e.g. TeacherScope) | `Authorization: Bearer lc_at_…` |
| Admin API key | Admin / developer tools only | `Authorization: Bearer lc_…` |

OAuth tokens are teacher-scoped: they can only access data belonging to the teacher who authorized the connection. Admin API keys are developer-only and must not be shared with teachers.

---

## OAuth 2.0 Authorization Code Flow

### Step 1 — Redirect the teacher to the consent screen

```
GET /oauth/authorize
  ?response_type=code
  &client_id=lcs_…
  &redirect_uri=https://yourapp.com/oauth/callback
  &scope=profile:read rosters:read results:read
  &state=<random_csrf_token>
```

The teacher signs in (if needed) and clicks **Allow access**. LessonCope redirects to your `redirect_uri`:

```
https://yourapp.com/oauth/callback?code=…&state=…
```

On denial:
```
https://yourapp.com/oauth/callback?error=access_denied&state=…
```

### Step 2 — Exchange the code for an access token

```http
POST /oauth/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "…",
  "redirect_uri": "https://yourapp.com/oauth/callback",
  "client_id": "lcs_…",
  "client_secret": "lcs_sec_…"
}
```

Response:
```json
{
  "access_token": "lc_at_…",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "profile:read rosters:read results:read"
}
```

Tokens expire after **1 hour**. Re-run the authorization flow to get a new token.

### Revoking a token

```http
POST /oauth/revoke
Content-Type: application/json

{ "token": "lc_at_…" }
```

Always returns `200 { "ok": true }`.

---

## Scopes

| Scope | What it grants |
|-------|----------------|
| `profile:read` | Teacher name and email |
| `rosters:read` | Roster list and student IDs |
| `results:read` | Game results and progress data |

Request all three for a full TeacherScope integration.

---

## API Endpoints

All endpoints require `Authorization: Bearer <token>` with the appropriate scope.

### Identity

#### `GET /api/v1/me`
Requires scope: `profile:read`

Returns the teacher who authorized this token.
```json
{ "id": "uuid", "email": "teacher@school.com", "name": "Ms Smith" }
```

---

### Rosters

#### `GET /api/v1/rosters`
Requires scope: `rosters:read`

Returns the teacher's rosters. Supports incremental sync.

Query params:
- `updated_since` — ISO 8601 timestamp; returns only rosters created after this time

```json
{
  "rosters": [
    { "id": "abc123", "teacherId": "uuid", "name": "Grade 5A", "studentCount": 28, "createdAt": "…", "updatedAt": "…" }
  ]
}
```

---

#### `GET /api/v1/roster/:id/students`
Requires scope: `rosters:read`

Returns all students in a roster.

```json
{
  "roster": { "id": "abc123", "name": "Grade 5A", "teacherId": "uuid", "createdAt": "…" },
  "students": [
    { "id": "STU-001", "name": "Alice Mokoena" }
  ]
}
```

---

#### `GET /api/v1/roster/:id/activities`
Requires scope: `results:read`

Returns all games (activities) that used this roster.

```json
{
  "roster": { "id": "abc123", "name": "Grade 5A" },
  "activities": [
    { "id": "game8char", "lessonTitle": "Fractions", "subject": "maths", "topic": "fractions", "grade": "Grade 5", "questionCount": 8, "createdAt": "…", "roomCode": "XK9P4M" }
  ]
}
```

---

#### `GET /api/v1/roster/:id/progress`
Requires scope: `results:read`

Returns aggregated progress data for every student in a roster.

```json
{
  "roster": { "id": "abc123", "name": "Grade 5A", "teacherId": "uuid", "createdAt": "…" },
  "students": [
    {
      "id": "STU-001",
      "name": "Alice Mokoena",
      "gamesPlayed": 5,
      "averagePercentage": 78,
      "updatedAt": "2026-06-20T10:45:00.000Z",
      "results": [
        { "gameId": "game8char", "topic": "fractions", "subject": "maths", "score": 7, "total": 8, "percentage": 88, "at": "…", "updatedAt": "…" }
      ]
    }
  ]
}
```

---

### Results (incremental sync)

#### `GET /api/v1/results`
Requires scope: `results:read`

All game results for this teacher's students, with pagination and incremental sync.

Query params:
- `updated_since` — ISO 8601 timestamp; returns only results recorded after this time
- `page` — page number (default 1)
- `limit` — results per page (default 50, max 200)

```json
{
  "results": [
    {
      "id": "game8char_STU-001_2026-06-20T10:45:00.000Z",
      "gameId": "game8char",
      "rosterId": "abc123",
      "studentId": "STU-001",
      "subject": "maths",
      "topic": "fractions",
      "score": 7,
      "total": 8,
      "percentage": 88,
      "at": "2026-06-20T10:45:00.000Z",
      "updatedAt": "2026-06-20T10:45:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 142, "pages": 3 }
}
```

**Sync pattern:**
1. First sync: fetch all results, store the timestamp of the most recent `updatedAt`.
2. Subsequent syncs: `GET /api/v1/results?updated_since=<last_sync_timestamp>`.

---

## Webhooks

Your app can receive real-time notifications instead of polling.

### Supported events

| Event | Fires when |
|-------|-----------|
| `roster.updated` | A roster is created or deleted |
| `result.created` | A student completes a game (roster-attached games only) |

### Payload format

```json
{
  "event": "result.created",
  "gameId": "game8char",
  "rosterId": "abc123",
  "studentId": "STU-001",
  "score": 7,
  "total": 8,
  "at": "2026-06-20T10:45:00.000Z",
  "deliveredAt": "2026-06-20T10:45:01.123Z"
}
```

### Verifying signatures

Every webhook POST includes `X-LessonCope-Signature: sha256=<hex>`.

```js
const crypto = require('crypto');
const expected = 'sha256=' + crypto.createHmac('sha256', YOUR_WEBHOOK_SECRET).update(rawBody).digest('hex');
if (!crypto.timingSafeEqual(Buffer.from(incoming), Buffer.from(expected))) {
  // reject
}
```

Always verify before processing.

---

## Admin: OAuth client registration

Done once, by the LessonCope admin, before TeacherScope can connect.

```http
POST /api/admin/oauth/clients
Authorization: Bearer <admin_api_key>
Content-Type: application/json

{
  "name": "TeacherScope",
  "redirectUris": ["https://teacherscope.com/oauth/callback"],
  "allowedScopes": ["profile:read", "rosters:read", "results:read"]
}
```

Response (save `clientSecret` — shown once):
```json
{
  "clientId": "lcs_…",
  "clientSecret": "lcs_sec_…"
}
```

### Register a webhook

```http
POST /api/admin/oauth/webhooks
Authorization: Bearer <admin_api_key>
Content-Type: application/json

{
  "clientId": "lcs_…",
  "url": "https://teacherscope.com/webhooks/lessoncope",
  "events": ["roster.updated", "result.created"]
}
```

Response includes the auto-generated `secret` you must give to the TeacherScope developer.

---

## Error responses

All errors return JSON with an `error` field:

```json
{ "error": "OAuth token invalid, expired, or revoked." }
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request / missing parameters |
| 401 | Missing or invalid token |
| 403 | Valid token but wrong scope or wrong teacher |
| 404 | Resource not found |
