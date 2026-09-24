# MoonQuest: Save the Festival

MoonQuest is a standalone diagram game with automatic classroom pacing, linked from My games.
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
   Up to six devices can join independently. In automatic practice, devices joining
   in the lobby replace unclaimed simulation seats, so one phone can rehearse the
   full flow without waiting for five bots. Rescanning in the same browser tab
   restores its practice seat. The private Open practice learner link does the
   same thing. Simulation fills only seats not controlled by a device, preserving
   the tester's own answers. No roster identities or student accounts are changed.
   Real class rooms still require the normal name/PIN flow and reject test entry.
5. Open the separate Smartboard link. Learners scan the QR or open
   `/moonquest/join`, enter its ten-character code, select their name and use
   their existing PIN. First-time learners establish a PIN using the existing
   student account mechanism. Public pickers use the existing abbreviated
   labels and scoped handles, not school IDs.

New sessions use automatic play by default, including games saved before this update.
Start once: a synchronized 24-second opening story leads into Choose (12 seconds for new games, capped at 14 for older timings) →
Discuss (15 seconds) → reconsider within discussion (5 seconds) → Reveal (10
seconds) → next question. First choice closes early when all expected learners
answer; discussion always receives its full time. Initial choices are locked
until reconsideration. Choosing again during reconsideration explicitly confirms
or revises the answer; doing nothing retains it without inventing confirmation.

The teacher has a sticky Pause/Resume and +10 seconds toolbar, also available
on the Smartboard when signed in as the room owner. The board token alone
never authorizes commands. A signed-out board offers a link to teacher controls.
The opening can be paused or skipped; reduced-motion mode shows static text. More than 70%
incorrect among submitted answers, or less than 80% participation, pauses the
reveal for teaching or device support. Resume continues the reveal countdown.
Approved follow-ups enter automatically after two intervening rounds. The final
round ends automatically. Teacher-paced mode remains an editor option. Existing
running sessions retain their original flow rather than changing mid-lesson.

The question is the largest element on a high-contrast card. Learner screens hide
navigation, music controls and moving scenery. The Smartboard and teacher dashboard show a live answered/expected count and
named answered/waiting chips. Those chips never include individual choices or
correctness. Aggregate correctness and distributions appear only after reveal.
Learner tokens do not receive the class roll call. Results preserve first answers, revisions and missing responses.

On the Smartboard, tap **Enable countdown sounds** once to unlock browser audio.
Each timed stage ticks gently with stronger final-five-second beeps and a stage
chime. Learner devices stay silent. Music and effects remain separately adjustable.
The teacher dashboard can also be opened on a signed-in phone using the same
session URL; only its owner can control it. Do not project that private view.

Timers are server-authoritative and checked on requests. Late joiners watch until
the next round; missing answers remain missing and cannot stall the countdown.
After a server restart the room recovers paused with saved answers intact.

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
  expose response-status names and revealed class totals, never individual
  answers, school IDs or private queues; they are session-scoped and replaceable.
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
