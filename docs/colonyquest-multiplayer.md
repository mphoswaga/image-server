# ColonyQuest: Colony rivals

An additional individual multiplayer mode. The existing `/colonyquest/:id`
smartboard game, teams, configuration and saved board session remain separate.
It reuses the lesson's questions, assigned classes, name/PIN login and learner
removal controls. No new AI generation or additional credits are required.

## Teacher workflow

1. My games → **ColonyQuest multiplayer**, or use the link in the original
   ColonyQuest setup. Review the existing questions before opening the lobby.
2. Select the class and open the lobby. Copy the learner link; students choose
   their existing names and use their usual PIN. Check attendance before Start.
   New players join in the lobby; existing players may reconnect during play.
3. Start once. Questions, upgrades and reveals advance automatically. Pause,
   resume and end remain available. Full screen projects the colony standings
   with the shared question and answer count.
4. Select a session under **Saved multiplayer reports** for question charts,
   learner evidence, missing answers, independent colony standings, CSV and
   print/PDF. Sessions retain their own question snapshots and can be reopened
   after subsequent games. Removed learners' submitted answers are retained.

**Test against computer colonies** creates an isolated practice room with three
computer opponents. It never records learner marks or alters a smartboard game.

## Round and colony rules

- Everyone answers the same multiple-choice question, with a 25-second limit.
  A submitted choice locks after a durable server save. Once everyone has
  answered, the phase ends (minimum four seconds for the question).
- Correct answers earn one upgrade: worker, food, materials, room, walls, guard,
  nursery egg or an eligible rival raid. The 12-second upgrade window can end
  early after everyone has chosen (minimum four seconds); an unused earned
  choice becomes food. A four-second reveal follows. Incorrect and unanswered
  learners still see the correct answer and explanation.
- Workers forage without clicks. Rooms and walls require sticks/leaves. Guards
  unlock after two rooms, so longer question sets give more opportunity for raids.
- Drought, rain and birds follow the same shared seasonal clock. The drought
  consumes a target of 12 food, shortages slow gathering, rain restores gathering,
  and walls protect stores. No learner is eliminated.
- Raids use the existing guard/wall combat rules but transfer at most five food,
  leave at least three food with the defender, and protect the defender through
  the next round. The same rival cannot be targeted again for three rounds.
  Guards need 45 active seconds to return. Disconnected colonies cannot be raided.
- Colony points never modify correct/incorrect learning marks. Missing responses
  remain absent answers, not invented wrong submissions. Reports state denominators.

## Music

Both smartboard and multiplayer use the supplied **Ghibli Station — The Mini
Vandals** and **Toys Are Us — Blue Deer Studio** recordings. The tracks play in
sequence and repeat. Sound controls mute the soundtrack and game effects; the
separate music slider adjusts the soundtrack volume. Music pauses with the game
or a hidden browser tab and resumes from the same position. Multiplayer starts
muted so learners can choose sound without a room full of simultaneous music.
Audio streams directly from static assets, independently of multiplayer updates.

## Reliability and storage

`colonyquest-multiplayer.js` is the authoritative round and resource engine.
`colonyquest-multiplayer-live.js` owns HTTP, tickets, sockets and persistence.
Browsers draw moving ants, rooms and weather locally; no sprite positions travel
on the network. Updates run once per second and coalesce bursts of decisions.

State is saved under `DATA_DIR/colonyquest-multiplayer` using asynchronous atomic
writes ordered by room. Commands are acknowledged after persistence. Match and
round IDs plus server-side idempotency prevent duplicate upgrades after retries.
Each completed session retains its own file and feeds ordinary saved game
results once; failed result writes retry. Include this directory in DATA_DIR backups.

A reconnect restores the same colony, answer and upgrade. A second tab replaces
its old socket; old tickets cannot join a replacement room. If every human
connection disappears, play pauses. After a process restart a running room
loads paused with its saved remaining time, awaiting teacher resume. Test rooms
resume automatically when their teacher returns.

Class membership and removal are checked at ticket issue, socket authentication,
commands and outgoing updates. Reports and controls require game ownership.
Answers stay private until reveal. The ordinary answer-check endpoint cannot
reveal answers to participants while they are in this live mode. Question edits
are blocked while its room is open.

Like current FishQuest, this requires one web process with a persistent DATA_DIR.
Multiple replicas need a shared room coordinator; this implementation does not
add one. Automated local load checks do not establish classroom Wi-Fi latency.

## Verification

- `node --test tests/colonyquest-multiplayer*.test.js`: simultaneous 30-client
  real-socket submissions, durable saves, raids and retries, class/owner access,
  removed/add-back learners, preview isolation, old session history, restart
  recovery, phase clocks, idempotency and resource rules.
- `npx playwright test tests/e2e/colonyquest-multiplayer.spec.js --project=windows-100 --project=mobile --project=desktop-safari`:
  real server and name/PIN flow, automatic phases, selected-state lock, upgrades,
  reload/resume, reports and separate teacher practice; visual screenshots.
- Existing ColonyQuest smartboard and FishQuest recovery browser tests, together
  with the repository unit suite and `npm run check`, cover shared entry points.

Before classroom rollout, use the deployed room with physical student devices
and the school's Wi-Fi, including a brief disconnect and reconnection.
