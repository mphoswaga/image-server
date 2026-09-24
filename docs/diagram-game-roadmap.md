# Diagram game roadmap

Planning baseline: LessonScope commit `bb052ca`, reviewed 24 September 2026.
Initial working name: **DiagramQuest**. The selected name and first theme are
**MoonQuest: Save the Festival**. See `moonquest.md` for the implementation and
verification record; this document retains the broader product roadmap.

## Product decision

Build a standalone, teacher-paced game under My games, alongside FishQuest and
ColonyQuest, available to games-only teachers too. A teacher can start directly
with a diagram without generating a lesson plan or slide deck. A second entry
point can reuse a visual from an existing lesson after the teacher confirms it.

The primary activity is selecting a region of a diagram, discussing the choice,
reconsidering it and seeing an explanation. It is not an arcade overlay or a
test/project mode. Preserve the requested choose–discuss–reconsider order.

## Findings from the current app

| Existing area | What can be reused | What must change for this game |
| --- | --- | --- |
| `games.js` | Teacher ownership, saved games, room-code lookup, multiple assigned classes | The mode whitelist and multiple-choice validation cannot represent diagram regions. Keep an explicit new mode and schema. |
| `image-server.js` game routes | Owned class selection, PIN verification, source uploads, question editing and launch conventions | Add diagram-specific authoring and session routes; do not expose correctness through generic answer endpoints. Audit every mode branch and public payload. |
| `public/join.html`, `roster.js` | Select learner name using a roster handle, verify PIN, retain roster identity | Route into the correct live session and selected class. Never rematch response records by display name. |
| `fishquest-live.js`, `fishquest-transport.js` | Authenticated socket tickets, private snapshots, bounded messages, reconnect and teacher ownership patterns | Build a separate discrete round controller. FishQuest currently ends active matches after a server restart; this game should restore paused. |
| `public/assessment-present.html` | Synchronized question presentation and response-count conventions | It polls every 1.5 seconds and belongs to assessments. Use its interaction lessons, not its assessment lifecycle. |
| `lesson-pack.js` | Instrumented AI generation, lesson context, credit reserve/capture/release conventions | Current game schema requires four choices and a correct index. Use region IDs, accepted regions, concept IDs and reviewed explanations. |
| `concept-diagram.js`, `svg-diagram.js`, existing visual assets | Potential source visuals for teacher selection | A slide illustration is not automatically an accurate interactive diagram. Add teacher-reviewed selectable regions. |
| `games.recordResult`, `gradebook.js` | Reporting entry points and weighting controls | Generic results retain the latest quiz score; that would erase learning stages. Add attempt history and an explicit formative evidence adapter. |
| `teacher-access.js`, games welcome UI | Games-only teacher journey and access conventions | Ensure creation, test, live hosting and results all work without visiting lesson planning. |
| `upload-security.js`, reliability docs and tests | Signature validation, image decoding tools, atomic persistence and browser/network tests | The game upload group currently accepts documents, not images. Add a bounded diagram upload path with dimension limits and normalized image assets. |

## Teacher experience

1. **Choose a diagram:** upload PNG/JPEG/WebP; preview and crop before defining
   regions. Store an immutable optimized copy with original dimensions.
2. **Make it clickable:** draw rectangles, ellipses or polygons; name each region;
   resize, undo, delete and preview. Coordinates are relative to the image, so
   resizing or zooming cannot move an answer target. Warn about overlaps and
   tiny targets; do not guess which overlapping region a learner intended.
3. **Prepare questions:** write questions or generate suggestions from the
   lesson objective and confirmed regions. Set accepted region(s), a short
   explanation and the concept being checked. Each question is single-selection
   in the first release, but may accept equivalent regions (e.g. either ear).
4. **Review and test:** teacher confirms all answer keys. A visible “Test game”
   creates an isolated practice session with simulated learners and no marks.
5. **Choose class and host:** verify the selected roster, show room code/QR,
   learner readiness and optional partner assignments. Reuse the same game for
   other classes in separate sessions, preserving earlier reports.

Allow multiple diagrams within a game, with each question referencing one.
The first editor iteration can start with one diagram; multi-diagram support
must be complete before the general release. Replacing an image invalidates
its region review rather than silently keeping misaligned targets.

## Three distinct live views

- **Smartboard:** large question, phase prompt, countdown and anonymous response
  counts. At reveal, show the diagram, correct region, explanation and class
  distribution. It has no student names, answer key before reveal or teacher
  controls. Use a scoped, revocable presentation token rather than a teacher
  session on the projected display.
- **Learner:** diagram, clear selected-region outline, “answer saved” receipt,
  phase instructions and accessible controls. A collapsed read-question option
  supports learners who cannot see the board. Never rely on colour alone.
- **Teacher:** names, attendance, first/final answers, unsubmitted learners,
  pause/extend/close-round controls, AI follow-up approval and a connection
  indicator. Keep this screen off the projector. Also support a single-device
  classroom through presentation mode with private controls hidden.

Use HTML/SVG overlays rather than a continuous physics/canvas game loop.
Keyboard navigation and a selectable region list provide equivalent access
when precise pointing is difficult. Selected labels must not contain answer
explanations. Support enlarged diagrams without cropping essential regions.

## Round contract

`Lobby → Read → Choose → Discuss → Reconsider → Reveal → Follow-up or Next`

- **Read:** teacher reads the prompt; choices remain locked until opened.
- **Choose:** learners select and submit one region. No correctness is revealed.
  A chosen answer remains editable until the teacher closes this phase or its
  deadline expires. Capture the final independent choice as first-choice data.
- **Discuss:** show “Discuss your choice with your partner”, default 20 seconds.
  Keep each first choice visible privately but locked. Do not show the class
  distribution, which could lead learners to follow the majority.
- **Reconsider:** “Are you sure about your answer?”, default 8 seconds. Learners
  can change or keep their choice. If they do nothing, carry the first choice
  forward. Record an explicit confirmation separately from an unchanged answer
  carried forward; do not manufacture a second response.
- **Reveal:** highlight correct accepted regions and explain why. Show correct,
  incorrect and unanswered counts and the change after discussion. Freeze all
  answers for this round. Teacher decides when to move on.

The teacher can adjust both timers, pause and resume, extend time, or close a
phase early. The server owns the deadlines and legal transitions. Never start
discussion because only the fastest learners have answered. Closing Choose
requires everyone expected for the round to submit, expiry, or teacher action.
Absent learners are not expected participants. A late joiner can watch the
current round and answer from the next one; a reconnecting participant resumes
their existing place and receives their saved choice.

## Adaptive question rule

Evaluate once after Reconsider: `incorrect / (correct + incorrect) > 0.70`.
Exactly 70% does not trigger it. No submitted answers means no automatic AI
request. Unanswered is always shown separately. If fewer than 80% of expected
participants submitted, propose the follow-up but ask the teacher whether to
wait, address a connection problem, or proceed with the available responses.
This participation safeguard is a proposed default, not a claim of mastery.

AI produces an alternative scenario/wording targeting the same concept and
accepted region IDs. Supply question text, grade, objective, reviewed region
labels and anonymous wrong-region counts; do not send learner names or IDs.
Keep correctness controlled by the reviewed key, not an AI-selected new key.
Validate output structure, available regions, wording and key consistency;
semantic correctness still requires teacher review.

Show a private queued suggestion with approve/edit/skip controls. Adapt the
language to the class level and misconception pattern. Do not announce a retry
to learners. Ask it after at least two intervening questions, at a teacher-chosen
moment, using a new scenario rather than a repeated answer cue. Avoid scenarios
already present in the game's other questions.
The game never stalls while waiting for AI. Pre-generate reviewed alternatives
during authoring where practical; if live generation fails, use an approved
alternative or let the teacher explain and continue. Cache per question version
and misconception pattern. Proposed limit: one automatic follow-up per original
question; further attempts require teacher action to prevent endless loops.

Because the original answer has already been revealed, label this attempt
**Later check** in private reports, separate from first encounters. It checks
application after feedback, and must not be reported as independent mastery.
Declare generation costs explicitly; no unexpected credit deduction or credit
dialog interrupting a live class. Choose pricing before release.

## Data, fairness and reporting

Separate the reusable game, immutable published version, classroom session,
round and response events. Each response includes session, question version,
roster, student, stage, selected region, event ID and server timestamp. Persist
accepted answers before acknowledging them; reject replayed, duplicate, stale
or late-phase submissions without corrupting results. Live sessions retain
their published diagram/question versions even if the teacher edits a draft.

Reports show first choice, post-discussion choice and after-feedback retry in
separate columns. Include wrong→right and right→wrong changes, missing answers,
participation and misconception counts. Do not treat unanswered as incorrect.

Recommended default: formative results visible under this game's reports, with
zero contribution to the class average. If teachers choose to count the game,
use first-attempt evidence with an explicit weight. TeacherScope export must
preserve phase/support labels and must not silently use retry correctness as
independent evidence. The current default game weight is 1, so exclusion must
be implemented across gradebook and external evidence paths, not just the UI.

No speed bonuses, elimination, stolen points or penalties for reconsidering.
Use cooperative class progress, restrained reveal animations and positive
feedback. Separate sound/music controls; default to quiet learner devices and
teacher-controlled board audio. Respect reduced motion and mute settings.

## Reliability and security requirements

- One server authority per session; timestamped snapshots, sequence numbers,
  idempotent actions and server-validated answers. No answer keys in learner
  payloads, loaded question bundles or pre-reveal diagram metadata.
- Persist phase, remaining time, versions and accepted responses. On restart,
  recover paused and let the teacher resume. A refresh must not restart a round.
- Reuse bounded socket messages, reconnect backoff, duplicate-tab handling and
  stale-connection detection. Show “reconnecting” instead of a frozen screen.
  An unsent choice is pending, not submitted; never backdate an expired answer.
- Preload each diagram and record readiness before opening Choose. Provide an
  explicit teacher override when a device cannot load the asset.
- Keep the existing single-process deployment initially; do not add replicas
  without shared session ownership. Use an ordered durable write path and
  measure its latency rather than assuming current synchronous file writes
  scale to many classes. No simulation tick loop is needed for this mode.
- Scope teacher, presentation and student access separately. Validate class
  membership server-side, expire/revoke session tokens and enforce upload and
  AI limits. Teacher test sessions cannot alter classroom sessions or reports.

## Delivery milestones and completion gates

| Phase | Deliverable | Gate before proceeding |
| --- | --- | --- |
| 1. Interaction prototype | Clickable teacher/board/learner prototype using one body diagram, full phase flow and simulated responses | Teacher can demonstrate the complete round and explain every control; mobile targets and board readability reviewed. No production marks. |
| 2. Authoring and storage | Diagram upload/editor, reviewed questions, published versions, reuse across classes, isolated test game | Save, reload, edit, resize and duplicate without losing regions, keys or identity. Draft edits cannot change running sessions. |
| 3. Live classroom engine | Roster/PIN join, all three views, phase timing, answer receipts, pause/reconnect/restart recovery | A complete manual-question game works with 30 clients; no leaks, duplicated responses or lost acknowledged answers in fault tests. |
| 4. Adaptive follow-ups | AI question drafts, threshold evaluation, private review, approved fallback | Test 70%, above 70%, unanswered, low turnout, malformed AI output, timeouts, credit failure and retry limits. Existing game keeps working. |
| 5. Reports and integrations | Attempt history, misconception report, export, explicit weighting and phase-aware TeacherScope evidence | Reconcile every displayed count against stored events. Reusing a game for another class preserves prior results. No unintended average changes. |
| 6. Classroom polish and release | Audio controls, accessible selection, projection layout, games-only entry, help and telemetry | Physical classroom pilot, full regression tests, verified deployment version and successful saved report after reconnect. |

Proposed test targets: 30 learners in one room and three concurrent 30-learner
rooms for a 40-minute session; measure actual hosting latency and resource use.
Aim for 95th-percentile acknowledged selections below one second on the test
network, no lost acknowledged answers and no duplicate scoring. These are
acceptance targets to measure, not current capacity claims. Exercise desktop
Chrome, Safari and Edge, tablet touch, mobile layout, zoom, keyboard-only use,
background tabs, teacher refresh, slow assets, Wi-Fi interruption and restart.

Run a pilot with the human-body example, a plant diagram and a map to expose
subject-specific assumptions. Gate broad release on two physical learner
devices plus a Smartboard and then a full class. Deploy behind a game-specific
feature flag so access can be stopped without deleting games or results.

## Recommended build order

First prove the diagram editor and complete live round with teacher-written
questions. Then add AI authoring and rephrasing, reporting and classroom polish.
Keep all six phases in scope for the finished product. AI should enrich a
working game, not be required for the class to continue playing.

Planning decisions to confirm during the prototype: final name, participation
safeguard, timer defaults, whether the teacher wants first-attempt marks to count
by default, and AI generation pricing. Recommended defaults above allow design
work to proceed without blocking on those choices.
