# MoonQuest: Save the Festival

MoonQuest is a standalone, teacher-paced diagram game, linked from My games.
Games-only accounts can use every MoonQuest route. The first theme is a
cooperative Moon Festival rescue, with Pip the mischievous alien, lantern
sparks, quiet-by-default audio, independently controlled music/effects, and
reduced-motion support.

## Teacher workflow

1. Open My games → MoonQuest. Upload a PNG, JPEG or WebP, or start with the
   editable senses example. Uploads are decoded, stripped of metadata and
   normalized to a bounded WebP; originals are not served.
2. Define labelled rectangle, ellipse or polygon answer areas. Existing areas
   can be renamed, moved, resized or redrawn without changing their IDs.
   Add multiple diagrams when needed.
3. Write questions or request AI drafts. Each needs an objective, accepted
   region(s) and explanation. Confirm review before saving. AI authoring uses
   the existing classroom-game credit action and shows its effective price.
4. Select one class per session, or choose Test game. Scanning a test room's QR
   automatically assigns a practice learner without a name, PIN or account.
   Up to six devices can join independently; rescanning in the same browser tab
   restores its practice seat. The private Open practice learner link does the
   same thing. Simulation fills only seats not controlled by a device, preserving
   the tester's own answers. No roster identities or student accounts are changed.
   Real class rooms still require the normal name/PIN flow and reject test entry.
5. Open the separate Smartboard link. Learners scan the QR or open
   `/moonquest/join`, enter its ten-character code, select their name and use
   their existing PIN. First-time learners establish a PIN using the existing
   student account mechanism. Public pickers use the existing abbreviated
   labels and scoped handles, not school IDs.

The round is Read → Choose → Discuss → Reconsider → Reveal. The teacher opens
answers after reading the question. Choice closes after everyone expected has
answered, its timer expires, or the teacher closes it. Default timings are
30/20/8 seconds. Discussion locks choices. Reconsideration allows a change or
explicit confirmation; no action retains the first answer without fabricating
a confirmation. Teachers can pause, extend or advance, and mark joined learners
away between rounds. Late joiners watch until the next round.

## Delayed adaptation

After reveal, `wrong / (correct + wrong) > 0.70` queues a concept to revisit.
Unanswered is separate; less than 80% participation is flagged for review.
The teacher's live controller starts a nonblocking suggestion request (practice
rooms require a deliberate click). AI receives grade, concepts, reviewed region
labels, prior question prompts and anonymous answer counts, never learner names
or IDs. Structured output restricts answers to the original reviewed key;
server validation checks it again. Semantic accuracy still requires teacher
approval. The teacher can edit/write a replacement or skip it.

A challenge becomes available after two other completed rounds. It can be
asked later from the private queue; learner screens present it as an ordinary
new challenge. At most one follow-up is queued for each original question,
with two included AI generation attempts. Requests time out after 18 seconds
without SDK retries. The class continues even when AI is unavailable. If a
concept is flagged at the end of a short game, there may not be enough remaining
rounds to revisit it; the teacher can finish with it recorded for future teaching.

## Persistence and security

- Data is in `DATA_DIR/moonquest`: reusable games, session snapshots and normalized
  assets. It does not use the existing latest-score arcade result file.
- Every accepted answer records learner, stage, region, event ID and server time,
  and is written atomically before acknowledgement. Retries are idempotent.
- Session snapshots preserve the reviewed game version. Later game edits do not
  change a class already playing. Optimistic editing protects saved games.
- Read-only snapshots expose no correctness before reveal. Smartboard tokens
  expose anonymous progress only, are session-scoped and can be replaced.
- Learner tokens are signed, session-scoped and expire in 12 hours. Teacher
  ownership is checked on editing, sessions, AI and reports. Mutations check
  browser origin; join, upload and generation use the app's rate limiters.
- A server restart restores active sessions paused with acknowledged answers.
  Browser refresh and reconnect use the same saved state. The timer uses server
  time; clients poll single-flight with a timeout and visible connection status.
- This implementation is for the app's current single-process deployment and
  persistent volume. Multiple server workers require shared room authority.
- `MOONQUEST_ENABLED=false` disables API access without deleting saved data.

## Results and integration boundary

The private report and CSV preserve initial choice, revised choice, explicit
confirmation, question and later-check labels. Missing responses remain blank.
Practice reports are clearly identified. MoonQuest is formative: **no marks are
written into existing gradebook averages or TeacherScope evidence**. An optional
graded mode and TeacherScope consumption are separate future integrations; they
must preserve stages and never substitute supported retries for first attempts.

## Verification

- Core tests cover geometry validation, hidden keys, retained first/final answers,
  strict 70% threshold, unanswered denominator, pause/deadline handling, duplicate
  submissions, late joiners, delayed follow-ups and recovery across a store restart.
- Browser tests use real local APIs for authoring, saved games, editable areas,
  isolated testing, PIN joins, Smartboard privacy, reports and delayed review.
  Chrome desktop, mobile Chrome and Safari are covered.
- A local 30-client HTTP test checks concurrent answer receipts, revisions,
  reporting and unauthorized teacher/report reads. It is not a classroom Wi-Fi
  or sustained multi-room benchmark.
- A real model sample returned five draft questions and an answer-key-preserving
  follow-up after the strict schema was added. An earlier invalid key was rejected.

Before broad classroom release, run a complete lesson with actual learner
devices and the Smartboard. Long-duration and three-room load targets from the
roadmap remain to be measured. No deployment is implied by local test success.
