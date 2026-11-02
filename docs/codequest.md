# CodeQuest: Treasure duels

Teacher-led, independent-device coding duels. New competitions generate fresh 6×6 islands across five difficulty levels, with movement and turn blocks, collect, and bounded repeats. No external assets, libraries, code execution or AI generation is needed to play.

## Launch and test

My games → Choose a game → CodeQuest → Choose play format. Select an existing activity assigned to the class; its roster supplies the learners, not its quiz questions. Open the lobby, share its learner link, wait for learners to join, then Start duels. Existing student sign-in/PIN policies apply. Learners joining through the room code can select CodeQuest while a class session is active.

Select Test treasure duels for isolated sample data. Open the lobby, then Play as sample learner in its new tab, and Start duels in the teacher tab. The sample learner competes with Captain Byte, explicitly labelled as a computer. No learner records or quiz marks are written. A real odd-numbered class also receives one labelled computer opponent.

## Round rules

Teacher chooses 60/90/120/180 seconds and 1–5 rounds. New competitions begin with a shared five-second staging window: a brief on-deck moment followed by 3–2–1. Only then does the full building time begin. Students are shuffled into simultaneous pairs at each round. All have the same island. Each builds privately and can test locally as often as needed. Programs autosave; the Ready control confirms and locks the current code. Both programs remain hidden from opponents and teachers until reveal. All ready, or the shared deadline, locks all code and starts a shared hands-off / 3–2–1 launch. Replays begin at one authoritative server timestamp, even when clients poll at different times. Programs and winners stay private through the launch countdown. The control room shows class readiness, completed duel counts, and a compact selector for the smartboard replay. Teacher can select a pair on the smartboard; each learner sees their own pair. The teacher advances to the next round after results, allowing discussion.

Success means collect the chest and return to the starting ship. Success beats failure; if both succeed, fewer executed actions wins; equal actions draw. Failed routes draw, with specific obstacle/collection feedback. Coding wins/solved counts appear on the competition leaderboard, never as fabricated MCQ marks. Teacher Finish ends the competition; Set up again creates a fresh lobby. A separate unsupervised single-player product is not part of this release.

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

CodeQuest streams the existing locally hosted ColonyQuest soundtrack (Toys Are Us, Blue Deer Studio; shared player can fall back to Ghibli Station, The Mini Vandals). Music is quieter during practice/coding and louder during the showdown. Music and effects have separate toggles. Playback respects user activation, explicit mute, teacher pause, hidden tabs, page exit and the end of the competition. A blocked autoplay attempt offers Play music, and one tap retries rather than inadvertently muting. Music failure does not block coding. Polling does not reset the track.

Tests verify real browser MP3 decoding/playback, mute/retry behavior, pause/resume, hidden-tab suspension, distinct portraits matching playing/replay avatars, responsive layout, and all four facing directions on desktop and mobile.
