# CodeQuest: Treasure duels

Teacher-led, independent-device coding duels. The initial release contains five original 6×6 island missions, movement and turn blocks, collect, and bounded repeats. No external assets, libraries, code execution or AI generation is needed to play.

## Launch and test

My games → Choose a game → CodeQuest → Choose play format. Select an existing activity assigned to the class; its roster supplies the learners, not its quiz questions. Open the lobby, share its learner link, wait for learners to join, then Start duels. Existing student sign-in/PIN policies apply. Learners joining through the room code can select CodeQuest while a class session is active.

Select Test treasure duels for isolated sample data. Open the lobby, then Play as sample learner in its new tab, and Start duels in the teacher tab. The sample learner competes with Captain Byte, explicitly labelled as a computer. No learner records or quiz marks are written. A real odd-numbered class also receives one labelled computer opponent.

## Round rules

Teacher chooses 60/90/120/180 seconds and 1–5 rounds. Students are shuffled into simultaneous pairs at each round. All have the same island. Each builds privately and can test locally as often as needed. Programs autosave; the Ready control confirms and locks the current code. Both programs remain hidden from opponents and teachers until reveal. All ready, or the shared deadline, starts simultaneous replays for all pairs. Teacher can select a pair on the smartboard; each learner sees their own pair. The teacher advances to the next round after results, allowing discussion.

Success means collect the chest and return to the starting ship. Success beats failure; if both succeed, fewer executed actions wins; equal actions draw. Failed routes draw, with specific obstacle/collection feedback. Coding wins/solved counts appear on the competition leaderboard, never as fabricated MCQ marks. Teacher Finish ends the competition; Set up again creates a fresh lobby. A separate unsupervised single-player product is not part of this release.

## Reliability and scope

Programs use a strict interpreter (32 top-level blocks, 40 authored blocks, 64 expanded actions, one repeat level, 2–5 repeats). No eval. Server calculates outcomes, deadlines and ready state. Learner commands are session-, round- and revision-scoped. Teacher ownership and class membership are validated. Clients cannot create competitions, advance rounds, control another student, or award wins. Private test simulations do not submit results.

Sessions are atomically stored under DATA_DIR/codequest with preview/class isolation. A service restart pauses active coding/replay at last persisted time; the teacher resumes. There are no long-running client animation loops: a 100ms scene clock updates CSS-interpolated positions and skips hidden documents. Polling uses 1.5 seconds and only one outstanding request. Assets explicitly use no-store. Reduced motion disables transitions and celebrations. Mobile uses tap-to-add plus accessible reorder buttons; dragging is optional.

## Validation

Node tests cover solvability, code limits, deterministic results, efficiency/draws, privacy, deadline/pause, stale writes, odd pairing, route authorization, preview isolation and restart recovery. Playwright covers teacher sample/editor/replay and two authenticated learner contexts, joining from the standard learner link, desktop/mobile and protected teacher controls.
