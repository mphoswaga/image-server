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

## Living colony graphics

The multiplayer renderer uses its own illustrated soil and transparent chamber
art. The smartboard renderer is unchanged. Rooms are drawn from the same earned
room definitions as the economy: queen chamber, pantry, barracks and expansions.
Workers follow foraging, gathering, carrying and unloading paths through the
entrance into storage. Some workers alternate indoor tending trips. Guards patrol.

An earned upgrade triggers a brief local scene: digging, wall construction,
delivery, a new worker, an egg or a guard. Eggs hatch only when the saved colony
state says they did. Raid animations use the actual server outcome. No extra
choice, modal or confirmation is added. Replayed snapshots and reconnections do
not replay old rewards; paused/offline/hidden games stop movement. Reduced-motion
settings keep workers stationary and retain visual feedback. Resource counters
always come from the server. Artwork and animation add no position packets.

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

## Shared story in individual multiplayer

New multiplayer matches follow the smartboard game's Ancient Acorn adventure:
Pip, Queen Aurelia, Dot and Bramble introduce berry and seed discoveries, the
spider, tunnel repairs, a lost scout and new territory. Dry season, rain, birds
and the human footsteps use the main game's resource and protection rules.
The ending celebrates the Ancient Acorn champions; penalties affect colony
points, never the learners' saved assessment marks.

Scenes play automatically between questions. Learners still only answer and
choose an upgrade. Question clocks and resource collection wait during scenes;
teachers can pause, and reconnects restore scene progress without repeating
resource rewards. Eight or more questions include all six optional encounters;
shorter games use fewer discoveries while retaining the seasonal adventure and
ending. Existing saved matches keep their original flow; start a new match to
use the story sequence.

`tests/colonyquest-story.test.js` checks scheduling, outcomes, answer privacy,
pause/restart and legacy saves. `tests/e2e/colonyquest-story.spec.js` checks every
animated scene on desktop, mobile and Safari, including paused animation clocks.

## Multiplayer presentation

Workers and guards use the original smartboard character artwork. Local walking
poses keep characters upright through tunnels, with carried materials and larger
figures. Resource gain labels reflect confirmed state changes only and do not
repeat when the same snapshot arrives again. Existing soil and chamber art remain.

The learner HUD shows actual food, building materials, workers and guards, plus
nest fortification and the next survival preparation target (12 food, then wall
upgrades for rain, birds and footsteps). These are existing rules, not additional
clicks or mechanics. Illustrated upgrade cards and colony point bars keep the
answer-and-upgrade interaction intact. Reduced motion and paused/offline clocks
also apply to character movement and resource feedback.

Both ColonyQuest modes now use coordinated leg, body and cargo motion. Smartboard
action actors release their gait tweens on destruction; standing ants settle
rather than continuously walking in place. Multiplayer gathering and unloading
have distinct poses, while raids show rally, approach, clash and return stages.
These effects use existing outcomes and do not add clicks, scoring changes or
network traffic. Reduced-motion mode avoids the walking dust and moving poses.
