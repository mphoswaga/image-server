# Classroom readiness audit — 30 September 2026

## Changes
- Visible sharing and dashboard labels use **Analysis report**. New links use `/moonquest/analysis`; existing `/moonquest/observe` links remain valid.
- Room discovery has a separate bounded rate limiter, so loading/retrying the room picker does not consume the shared school IP's PIN/sign-in allowance.
- Real duels wait for every included learner to sign in before the first question. Teachers can mark absent learners rather than letting them silently miss the first round.
- A failed network acknowledgement retries once using the same answer receipt. A slower response cannot replace newer client state.

## Verified behavior
- Previous duel losses do not eliminate learners. A 25-learner five-question store simulation saved all 125 responses.
- A local HTTP burst exercised 90 room lookups, 25 sign-ins, 25 simultaneous state reads and 25 answers. All succeeded; the analysis and saved report totals agreed. Local state-read p95 was 13 ms; this is not a measurement of school Wi-Fi or production classroom load.
- Browser tests cover team setup, attendance, sign-in, answer selection, lost acknowledgement, reload, story/duel transitions, time extension, report sharing/revocation, saved reports and region editing.
- Production read-only validation found the Output game's ten questions valid and all four diagram assets present. No live learner answers or existing sessions were modified during the audit.

These checks establish the tested behavior, not a guarantee against network or device faults. The teacher can pause the game if devices lose connectivity.
