# LessonScope Stability and Scale Roadmap

## Purpose

LessonScope is feature-complete enough for real teacher use. The next phase should improve security, reliability, maintainability, and scale without changing familiar workflows.

This roadmap deliberately puts operational hardening ahead of new features. Every phase must preserve:

- Existing EducScope sign-in and wallet behavior.
- Single-lesson and multi-lesson generation.
- School templates, pacing guides, source materials, and teaching models.
- Deck editing, PowerPoint downloads, Google exports, and YouTube slides.
- Rosters, assignments, student games, and Grade 2/3 practice.
- Teacher preview, guest practice, live rooms, scoring, and reporting.

## Current Baseline

- Main branch is the production source of truth.
- Pre-roadmap automated baseline: 232 passing tests; the local hardened build
  currently passes 242 tests.
- Health endpoint identifies the deployed commit.
- Mutable production data currently depends heavily on local JSON files and a persistent volume.
- The main teacher interface is a large single HTML file.
- Billing, authentication, AI generation, uploads, and student participation are already production-facing surfaces.

## Delivery Rules

1. Make one risk category per commit.
2. Keep migrations backward-compatible until production verification is complete.
3. Never combine a data migration with a major UI redesign.
4. Run `npm run check && npm test` before every push.
5. Test signed-in teacher, signed-out teacher, student, guest, and admin paths where relevant.
6. Deploy behind disabled-by-default feature flags when behavior can affect billing, auth, or stored data.
7. Record the running commit and a rollback target before each production change.

---

## Phase 1: Security Baseline

**Priority:** Immediate
**Target:** 2-4 focused development days

**Progress:** In progress. Safe dependency upgrades, upload signature/archive
limits, production security headers/cookies, and configurable route-class rate
limits are implemented locally. Spreadsheet/parser replacement or process
isolation remains before this phase can be marked complete.

### Work

- Upgrade Axios and all safely upgradable transitive packages.
- Document and isolate packages that cannot be safely upgraded yet.
- Replace vulnerable spreadsheet parsing paths where practical with the existing ExcelJS toolchain.
- Add strict MIME, extension, signature, file-count, and decompressed-size checks for uploads.
- Reject unsupported files before parsing.
- Add parsing timeouts or worker isolation for complex user uploads.
- Add request throttling for:
  - Login and signup.
  - Password reset.
  - Student PIN and room-code attempts.
  - Guest/live-room joins and checkpoints.
  - AI generation and assistant requests.
  - File uploads.
- Add production security headers and disable `X-Powered-By`.
- Set session cookies explicitly to `secure` in production while preserving local development.
- Add tests for rate-limit responses, rejected uploads, and secure-cookie configuration.

### Exit Criteria

- No safely fixable high-severity production dependency advisory remains.
- Unsupported and maliciously shaped uploads fail cleanly.
- Public endpoints resist brute-force and request-flood behavior.
- All existing tests plus new security tests pass.
- Login, wallet, generation, student join, and live practice pass production smoke tests.

### Rollback Point

Tag the current production commit before security middleware is enabled. Keep rate limits configurable through environment variables for the first deployment.

---

## Phase 2: Observability and Recovery

**Priority:** High
**Target:** 2-3 focused development days

**Progress:** Application work implemented locally. Requests now carry safe
correlation IDs and structured logs; admins can inspect bounded operational
counters; readiness checks writable storage and free capacity; and checksum
backups have passed a byte-for-byte restore test. Scheduling encrypted offsite
copies and connecting an external alert provider remain deployment tasks.

### Work

- Add structured request and error logging with request IDs.
- Add error monitoring for server exceptions and failed browser workflows.
- Track generation latency, AI failures, wallet failures, export failures, and upload-parser failures.
- Add alerts for repeated 5xx responses, unusual AI spend, low disk space, and webhook failures.
- Add `/readyz` separately from `/healthz` for dependency readiness.
- Define retention rules for logs and student-sensitive information.
- Automate persistent-volume backups while file storage remains in use.
- Perform and document one restore test.

### Exit Criteria

- A production failure can be traced from teacher action to request ID and server error.
- Deployment health, AI availability, wallet availability, and storage health are visible.
- A backup has been restored successfully in a non-production environment.

### Implemented controls

- `GET /healthz` for liveness and deployed commit.
- `GET /readyz` for persistent-volume readiness.
- Admin-only `GET /api/admin/operations` for request, latency, and failure
  counters.
- JSON request/error logs with `X-Request-ID` correlation and secret redaction.
- Failure categories for AI, export, upload, wallet, and other operations.
- Manifested SHA-256 backup, verification, and empty-target restore commands.
- Operator and restore runbook in `docs/operations-and-recovery.md`.

---

## Phase 3: Browser and Workflow Reliability

**Priority:** High
**Target:** 3-5 focused development days

**Progress:** Local implementation complete. The suite covers critical teacher,
student, shared-session, generation, export, and live-classroom workflows across
Windows Chrome at three common effective resolutions, tablet, mobile, and
desktop Safari. It also checks horizontal overflow, action overlap, navigation
clickability, keyboard activation, and visual baselines. Production EducScope,
OpenAI, and Google credentials still require a short post-deploy smoke test;
automated tests use controlled local service doubles and spend no credits.

### Work

- Add end-to-end tests for the complete teacher journey:
  - EducScope sign-in.
  - Upload/select pacing guide and lesson template.
  - Generate and review a lesson.
  - Generate slides.
  - Download PowerPoint and start Google export.
  - Create a roster and assignment.
- Add end-to-end tests for student and practice journeys:
  - Student join and PIN flow.
  - Guest Grade 2 to Grade 3 continuation.
  - Teacher-controlled classwork lobby.
  - Timer expiry and teacher end-game propagation.
  - Private learner score screens and teacher leaderboard.
- Test these viewport/browser profiles:
  - Windows Chrome, 1366x768, 100%, 125%, and 150% scaling.
  - Desktop Safari.
  - Tablet landscape and portrait.
  - Small mobile viewport.
- Add visual regression screenshots for the planning wizard, roster import, deck editor, lobby, and every practice mission.
- Add keyboard navigation and focus checks for dialogs and major workflows.

### Exit Criteria

- Critical workflows pass automatically on every release.
- No overlapping buttons, clipped text, inaccessible dialog, or frozen navigation at supported sizes.
- Grade 2 and Grade 3 missions are independently reachable in teacher preview.

### Implemented controls

- Playwright release suite with retained traces, screenshots, and videos on
  failure.
- Disposable isolated data directory and teacher account for each browser run.
- Windows Chrome coverage at 1366x768, 1093x614, and 911x512 effective
  viewports, plus tablet, mobile, and desktop WebKit/Safari coverage.
- Automated checks for guest practice entry, Grade 3 direct entry, the
  three-step planning wizard, desktop navigation clickability, and roster
  action visibility.
- Keyboard-only activation checks for primary navigation, roster expansion,
  lesson entry, and wizard progression.
- Reviewed visual baselines for the planning wizard and roster uploader at
  Windows desktop and small-mobile layout extremes.
- Coordinated teacher and learner browser test for classwork lobby waiting,
  teacher start, shared timer state, private learner scores, and teacher-driven
  room termination in Chromium and WebKit.
- Shared EducScope cookie bridge tests for trusted teacher-session creation and
  the signed-out response in Chromium and WebKit.
- Deterministic full creation journey from objectives through lesson-plan review,
  Gradual Release slides, PowerPoint download, and Google Slides export without
  calling paid external services.
- Geometry assertions that fail with the exact overflowing or overlapping
  element names.
- `npm run check:release` as the complete pre-release validation command.

---

## Phase 4: Database and Object Storage

**Priority:** Medium-high
**Target:** 2-4 weeks, delivered incrementally

### Architecture

- PostgreSQL becomes the system of record for:
  - Users and EducScope identity mappings.
  - Rosters and students.
  - Assignments, games, attempts, and results.
  - Practice rooms, participants, checkpoints, and scores.
  - Templates, planning-source metadata, and audit records.
- Object storage holds:
  - Uploaded templates and pacing guides.
  - Source materials.
  - Generated PowerPoints and handouts.
  - Runtime images and temporary exports.

### Safe Migration Sequence

1. Define schemas and repository interfaces without changing production reads.
2. Add dual-write behind a feature flag.
3. Backfill historical file data with checksums and counts.
4. Compare file and database reads automatically.
5. Switch one low-risk domain to database reads first.
6. Migrate domains individually: templates, rosters, results, then live rooms.
7. Keep file fallback available through a defined observation period.
8. Remove fallback only after backup and restore procedures are proven.

### Exit Criteria

- Multiple LessonScope instances can serve traffic safely.
- Concurrent writes cannot overwrite each other.
- Stored files survive deployments independently of the application container.
- Record counts and ownership match before and after migration.
- Rollback does not require discarding new user data.

---

## Phase 5: Frontend Modularization and Performance

**Priority:** Medium
**Target:** 2-3 weeks, incremental

### Work

- Establish a lightweight build pipeline without redesigning the product.
- Split the teacher interface into owned modules:
  - Authentication and suite bridge.
  - Planning wizard.
  - Template and pacing-guide library.
  - Lesson review and deck editor.
  - Resources, assignments, games, and gradebook.
  - Rosters and student progress.
  - Credits, settings, assistant, and admin.
- Load infrequently used admin and editor features only when opened.
- Add cache fingerprints for static assets.
- Compress text assets and optimize large images.
- Preserve URLs, element behavior, API contracts, and existing visual language.

### Exit Criteria

- The initial teacher page is materially smaller than the current baseline.
- Planning can load without downloading admin/editor code.
- Modules can be tested independently.
- No teacher workflow or stored draft is lost during the transition.

---

## Phase 6: Scale and Load Validation

**Priority:** After database migration
**Target:** 3-5 focused development days

### Work

- Load test 50, 100, and 250 simultaneous students.
- Test live-room joins, checkpoint bursts, leaderboard polling, and teacher end-game propagation.
- Load test simultaneous lesson and deck generation separately from student traffic.
- Add queueing and concurrency limits for AI generation, document parsing, and deck assembly.
- Measure CPU, memory, event-loop delay, database latency, object-storage latency, and API response percentiles.
- Set autoscaling rules only after the application is stateless enough to run multiple replicas.

### Initial Performance Targets

- Student interaction/checkpoint API: p95 below 500 ms under expected classroom load.
- Lobby and leaderboard refresh: p95 below 1 second.
- Ordinary teacher API reads: p95 below 750 ms.
- No lost checkpoints or duplicate charges under retries.
- End-game reaches active learners on their next poll/connection update without manual refresh.

### Exit Criteria

- A documented capacity number exists for one instance and for the scaled deployment.
- Student gameplay remains responsive while teachers generate content.
- Scaling does not create duplicate rooms, scores, reservations, or files.

---

## Recommended Release Order

### Release A: Harden

- Dependency upgrades.
- Upload validation.
- Rate limiting.
- Secure headers and cookies.

### Release B: See and Recover

- Structured logs.
- Error monitoring.
- Alerts.
- Backup and restore validation.

### Release C: Prove the Workflows

- Cross-browser end-to-end suite.
- Windows scaling coverage.
- Live-class simulation.
- Visual regression checks.

### Release D: Prepare to Scale

- PostgreSQL and object-storage interfaces.
- Dual-write migration.
- Domain-by-domain cutover.

### Release E: Simplify and Accelerate

- Frontend modularization.
- Lazy loading and caching.
- Load testing and autoscaling.

## Features to Hold Until Phase 3 Is Complete

New features do not need to stop entirely, but avoid adding another large subsystem before the reliability baseline is automated. In particular, defer:

- Additional game worlds.
- A second major deck-editing engine.
- More account systems.
- New billing models or independent wallets.
- Complex real-time multiplayer mechanics.

Small curriculum improvements, bug fixes, and teacher-requested content refinements may continue when they do not widen the operational surface.

## Definition of Production-Ready

LessonScope is ready for broader school adoption when:

- Security checks and supported dependency risks are addressed.
- Critical workflows are covered by automated browser tests.
- Production errors are observable and backups are restorable.
- Student and teacher data no longer depend on one application filesystem.
- A tested capacity figure exists for concurrent classes.
- Billing, authentication, generation, and live-room retries are idempotent.
- Every deployment has a verified commit, smoke test, and rollback target.
