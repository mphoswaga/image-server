# CodeQuest: Treasure duels

Teacher-led, independent-device coding duels. New competitions generate fresh 6×6 islands across five difficulty levels, with movement and turn blocks, collect, and bounded repeats. No external assets, libraries, code execution or AI generation is needed to play.

## Launch and test

My games → Choose a game → CodeQuest → Choose play format. Select an existing activity assigned to the class; its roster supplies the learners, not its quiz questions. Open the lobby, share its learner link, wait for learners to join, then Start duels. Existing student sign-in/PIN policies apply. Learners joining through the room code can select CodeQuest while a class session is active.

Select Test treasure duels for isolated sample data. Open the lobby, then Play as sample learner in its new tab, and Start duels in the teacher tab. The sample learner competes with Captain Byte, explicitly labelled as a computer. No learner records or quiz marks are written. A real odd-numbered class also receives one labelled computer opponent.

## Round rules

Teacher chooses 60/90/120/180 seconds and 1–20 rounds. New competitions begin with a shared five-second staging window: a brief on-deck moment followed by 3–2–1. Only then does the full building time begin. Students are shuffled into simultaneous pairs at each round. All have the same island. Each builds privately and can test locally as often as needed. Programs autosave; the Ready control confirms and locks the current code. Both programs remain hidden from opponents and teachers until reveal. All ready, or the shared deadline, locks all code and starts a shared hands-off / 3–2–1 launch. Replays begin at one authoritative server timestamp, even when clients poll at different times. Programs and winners stay private through the launch countdown. The control room shows class readiness, completed duel counts, and a compact selector for the smartboard replay. Teacher can select a pair on the smartboard; each learner sees their own pair. The teacher advances to the next round after results, allowing discussion.

The teacher selects Collect treasure (the easier UI default) or Collect and return to the ship. Success is evaluated against that shared goal for private tests, human programs and NPC programs. Existing saved competitions without a goal setting retain the original return-to-ship rule. Success beats failure; if both succeed, fewer executed actions wins; equal actions draw. Failed routes draw, with specific obstacle/collection feedback. Coding wins/solved counts appear on the competition leaderboard, never as fabricated MCQ marks. Teacher Finish ends the competition; Set up again creates a fresh lobby. A separate unsupervised single-player product is not part of this release.

## Reliability and scope

Programs use a strict interpreter (32 top-level blocks, 40 authored blocks, 64 expanded actions, one repeat level, 2–5 repeats). No eval. Server calculates outcomes, deadlines and ready state. Learner commands are session-, round- and revision-scoped. Teacher ownership and class membership are validated. Clients cannot create competitions, advance rounds, control another student, or award wins. Private test simulations do not submit results.

Sessions are atomically stored under DATA_DIR/codequest with preview/class isolation. A service restart pauses active coding/replay at last persisted time; the teacher resumes. There are no long-running client animation loops: a 100ms scene clock updates CSS-interpolated positions and skips hidden documents. Polling uses 1.5 seconds and only one outstanding request. Assets explicitly use no-store. Reduced motion disables transitions and celebrations. Mobile uses tap-to-add plus accessible reorder buttons; dragging is optional.

## Validation

Node tests cover solvability, code limits, deterministic results, efficiency/draws, privacy, deadline/pause, stale writes, odd pairing, route authorization, preview isolation and restart recovery. Playwright covers teacher sample/editor/replay and two authenticated learner contexts, joining from the standard learner link, desktop/mobile and protected teacher controls.

## Beginner controls and practice

Learners see four command tiles and two main actions: Test my code and Ready. A numbered, horizontally scrollable code strip replaces per-step arrow/delete controls. Tap a step to open a contextual editor with replacement commands, move earlier/later, or remove. Turning is explained as changing direction on the same square. Repeat is introduced from round three via a collapsed More blocks section; older saved code remains runnable.

Joined learners can choose an untimed practice voyage in the lobby. A deliberately blocked route teaches test → debug → test: replace the blocked move with Collect, turn around and return home. Practice runs locally and never sends code, readiness, marks or scores to the competition. Starting a real round exits practice immediately and loads the real, empty code. A failed test highlights the relevant instruction and gives a brief debugging prompt without adding another button. Practice does not prevent the teacher from starting the class.

Countdowns, launch and replays can all be paused. Old active competitions retain their previous timing; create a fresh lobby to use the staged sequence. Tests cover 25 learners/13 simultaneous pairs, no editing or opponent code exposure during staging, shifted pause clocks and safe early finish.

## Fresh island generation

New sessions store one generated map per round. All classmates and their NPC opponents use that same map; loading, pausing or reconnecting never regenerates it. Old saved competitions retain their existing fixed maps. The familiar practice voyage remains fixed and independent.

The server-only generator creates a protected path, places bounded rocks and a connected water patch, and validates the final shortest solution through the shared interpreter. Validation rejects overlapping ship/treasure/obstacles, disconnected land, scattered water, unsolvable return journeys, excessive clutter, inappropriate route length/turns, and missing block types. Later levels require an actual straight run that can benefit from Repeat. Full round-trip solutions fit 32 authored blocks and 64 executed actions; generated solutions use at most 31 actions. Difficulty bands are 7–11, 11–13, 15–17, 19–23 and 25–31 actions.

A bounded search is followed by independently generated, transformed fallback variants. Every fallback passes the same checks and exclusion list; if no valid fresh replacement is available, starting the round fails before modifying the previous round. Solutions, generator diagnostics and recent-map history are not included in learner responses.

The last 100 layout fingerprints are stored per teacher and class under DATA_DIR/codequest/map-history, shared across new competitions and source activities. Histories are merged before every round to handle overlapping lobbies. Preview history is separate and cannot replace classroom history.

QA includes 5,000 deterministic layouts across all levels, solution variety, 550 fallback/history cases, malformed-map rejection, shared-map checks for 25 learners, restart preservation, real route persistence and desktop/mobile play against generated puzzles. A 15-map visual review sheet is available under output/codequest-maps during development.

## Music and pirate identities

The shared countdown screens now show two named, inward-facing pirate portraits: a crimson captain and a teal navigator with a different hat, skin tone, feather and earrings. Pair side assigns the colour/outfit consistently across both learners’ screens, their own island and the duel replay. The roster’s normalized gender independently selects a male or female pirate, including during practice; missing/unrecognized gender uses a neutral model without guessing from names. Same-gender opponents still have different colours. Existing saved games refresh the appearance from the current roster without resetting code, marks, maps or timing. The portraits do not add another wait or click; they occupy the existing coordinated countdown and launch stages.

CodeQuest streams the existing locally hosted ColonyQuest soundtrack (Toys Are Us, Blue Deer Studio; shared player can fall back to Ghibli Station, The Mini Vandals). Music is quieter during practice/coding and completely silent during the opponent announcement and launch countdown; it resumes for building and replay unless explicitly muted. Music and effects have separate toggles. Playback respects user activation, explicit mute, teacher pause, hidden tabs, page exit and the end of the competition. A blocked autoplay attempt offers Play music, and one tap retries rather than inadvertently muting. Music failure does not block coding. Polling does not reset the track.

Tests verify real browser MP3 decoding/playback, mute/retry behavior, pause/resume, hidden-tab suspension, distinct portraits matching playing/replay avatars, responsive layout, and all four facing directions on desktop and mobile.

## Easier treasure goal and attention bell

The teacher chooses the treasure goal before opening the lobby. The choice is saved for the competition and cannot be changed by learner commands. Collect-only mode ends immediately after a successful Collect at the chest, without requiring a return route. Return mode keeps the original collect-and-return condition. Practice prompts, interpreter feedback, replay results and the computer pirate use the same goal. Generated maps retain their validated return routes and difficulty bands, and additionally validate the actual selected goal.

Effects default to on, with an explicit Effects off/on button. Once the browser has received a user gesture, the opponent announcement rings a bounded, locally synthesized metallic bell twice, 0.8 seconds apart, while music is silent. Polling does not repeat it. Muting effects, teacher pause, hiding the tab or leaving the page cancels pending bell audio; resuming the same announcement does not replay it. Late arrivals skip a stale bell when too little countdown time remains. Launch countdowns also silence music but do not repeat the opponent bell. Normal music starts/resumes with building or replay. Browser autoplay restrictions still require a user interaction before sound can start.

Coverage includes goal persistence/authorization, both winning conditions, 500 additional collect-only map validations, two-strike scheduling, mute/pause/visibility cancellation, and native desktop/mobile goal controls and bell timing.

## Coding workspace

During practice and coding, laptop/tablet layouts place the coding workspace on the left (60%) and the complete island on the right (40%). Instructions read down numbered columns, with Repeat actions visibly grouped inside their parent block. Test and Ready remain below the code; execution highlighting scrolls only the code area and keeps the island still.

Fit all code temporarily hides the command palette and expands the coding area, choosing the fewest columns that fit the program. The countdown and action buttons stay visible. Standard view restores editing controls without changing the program. Phones stack the island and code, allowing vertical scrolling for long programs instead of clipping instructions horizontally.

Browser coverage checks laptop sizes, tablet, Safari and mobile, including 32 steps with an eight-action Repeat body, reachable controls, stable stage position during testing and editing in Fit mode.

## Progressive rocks and learning reports

New generated competitions use non-overlapping rock bands: 2–3, 4–5, 6–7, 8–9 and 10–11 rocks across the five rounds, with one water cell in primary generation. Fallbacks must meet the same minimum rock counts, route/difficulty limits and connectivity checks. Rocks remain fixed within a round. Existing saved maps are preserved.

The teacher’s control room has Learning report, Refresh report, CSV download, Print / Save PDF, and Previous competitions. Reports include each learner’s completed/solved rounds, coding time (excluding pauses), test count, successful debugging evidence, submitted code, replay, test history, strengths and targeted next steps. Unfinished voyages are explicitly excluded from completion rates; learners without round evidence are shown without an invented judgement. Repeat feedback is optional practice, not a penalty. Direction and sequence errors are not diagnosed independently from a collision alone.

Private tests are normalized and replayed on the server, without altering the saved program or revision. Each learner retains the latest 50 test programs/results per round and a total test count; practice is excluded. Round evidence is snapshotted at reveal, or marked unfinished when the teacher finishes early. Server-side session records survive reconnects, and teacher/game-scoped report archives survive starting a new competition. Sample archives are isolated. Reports are requested explicitly rather than attached to frequent gameplay polling; learner responses never include another learner’s test history or reports. Existing competitions cannot reconstruct tests or rounds from before evidence collection was installed. Quiz marks remain unchanged.

QA covers 5,000 generated layouts, strictly increasing rocks across generated/fallback rounds, report persistence/access restrictions, early finishes, pauses, bounded tests, debugging evidence and real desktop/mobile report replay/export interactions.

## Repeat-stage block allowances

New generated rounds 3 onward require Repeat. Rounds after 5 use fresh level-5 islands. For the selected treasure goal, the generator finds a shortest unrestricted action sequence, compresses straight runs using the same single-action Repeat controls learners have, and checks that compression saves authored blocks. Its allowance is the compressed solution’s authored size plus one spare block when possible, always strictly below the shortest unrestricted action count. Thus a successful program without Repeat cannot fit, while a verified Repeat solution does. Primary and fallback maps pass these checks for both collect-only and return goals. No solutions are sent to learners.

The Repeat container and each instruction in its body count once; the repeat multiplier does not add authored blocks. The editor shows used/allowed/remaining blocks and explains the rule. Additions and edits cannot exceed the allowance; removing blocks frees space. Private tests, saves and Ready enforce the same limit on the server. Computer pirates use compressed solutions within that allowance. Early rounds, practice and existing saved maps retain their previous allowances; a running island is never retroactively restricted. Reports distinguish mandatory Repeat islands from earlier optional opportunities.

Coverage includes both goal modes across all five levels and primary/fallback paths, proof that the allowance is below the shortest no-loop route, valid compressed solutions, child/container counting, server rejection without state mutation, NPC fairness, persistence, and desktop/mobile limit-counter/edit/reload flows.

## Pirate opening and closing seconds

Start duels opens a teacher-only parchment story before the competition starts. Play story reads four goal-specific paragraphs using the natural Marin voice with an original theatrical pirate delivery, highlighting each spoken paragraph. The Pirata One title font is self-hosted under its bundled SIL Open Font License. Story body text stays readable. Skip/close returns to the lobby; Start game stops narration and begins the shared countdown. A Pirate story button reopens it in the lobby. Narration is labelled as AI, cached under the persistent data directory per teacher, and limited to fixed story parts through an owner-authorized endpoint. Unavailable audio leaves the readable story and Start controls usable. Closing, changing competition, leaving the page or hiding the tab stops playback.

Final coding seconds 5–1 each get a rising local beep, followed by a lower, longer code-lock cue. Effects mute applies to all cues. Paused/hidden tabs do not emit countdown beeps; polling does not duplicate a second. Music softens near the deadline. Classroom story narration is played only from the teacher computer.

## Teacher live deck and early readiness

When all paired participants are Ready, coding ends immediately and a two-second synchronized launch countdown leads into replay. Timer expiry retains the existing five-second launch cue. Every learner sees the same server launch time and an everyone-ready announcement.

The teacher control room shows a live countdown, human learners ready/total, learners who have tested, total tests, Repeat use, a readiness progress bar, learners still preparing and the latest activity per learner. Counters exclude computer pirates. Saves, private tests and Ready record their activity timestamp. Only teacher responses include this live activity data; opponents still cannot inspect private tests or programs. This describes observable activity rather than inferring mastery. The existing saved learning report remains the detailed review tool.

## Celebration music

Round results and the final winners screen switch to an original locally hosted 12.8-second upbeat treasure celebration, with melody, harmony, bass and percussion. It loops while results are displayed, uses the Music control, respects hidden tabs and page exit, and stops when the next coding round begins. Polling and moving from round results to the final podium do not restart it. Reconnecting to a result screen starts its celebration normally. The regular soundtrack remains silent underneath. Browser tests decode and play the actual WAV on desktop and mobile, including finish, mute/retry and the next round.

## Embedded coding variations and curriculum evidence

New competitions created from the updated interface enable small duel variations. In each eight-round cycle, round 2 asks for an ending-square prediction before a private test, round 4 supplies a longer correct program to shorten, and round 6 asks learners to mark reach/collect/return boundaries (reach/collect for collect-only goals). Other rounds keep normal duels. All paired learners receive the same challenge. Existing saved competitions retain their original rules.

Predictions are program-specific, recorded before evaluation, immutable for that program, bounded to 50 per learner/round, and hidden from opponents. Edited programs require a new prediction before testing. Ready cannot bypass a prediction or required grouping. A supplied simplification program is a visible reference, with the normal authored-block allowance still enforced for submitted code. Section choices persist with code and are verified against actual successful execution for report evidence.

Reports and CSV export now include supporting evidence by objective, with round references. Saved evidence includes predictions, chosen squares/correctness, supplied reference code and section boundaries. Successful shortened code supports 3CT.02/3P.01; correctly grouped completed voyages support 3CT.06. Prediction evidence is labelled cautiously for 3CT.05 because endpoint prediction does not alone establish prediction of a specific edit. Logical reasoning, everyday-task repetition and inputs/outputs are not automatically declared mastered; report notes identify the required direct teacher checks. Gameplay wins and assessment marks are unchanged. Practice does not collect these challenge responses.

## Test a selected round

In the teacher’s sample game (`test=1`), Test a specific round lists all 20 rounds with their variation labels and a collect-only/return goal selector. Load selected round prepares a fresh isolated sample competition at that round; Play selected round opens the sample learner against the explicitly labelled computer pirate. It does not require playing through earlier rounds. Replacing an active sample requires confirmation. The server restricts round selection to the owning teacher in preview mode, validates round and goal, and preserves the real class session and class map history. Sample learners and real-class requests cannot use this control.
