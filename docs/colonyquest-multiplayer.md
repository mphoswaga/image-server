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
   with each learner’s question progress and finished count.
4. Select a session under **Saved multiplayer reports** for question charts,
   learner evidence, missing answers, independent colony standings, CSV and
   print/PDF. Sessions retain their own question snapshots and can be reopened
   after subsequent games. Removed learners' submitted answers are retained.

**Test against computer colonies** creates an isolated practice room with three
computer opponents. It never records learner marks or alters a smartboard game.

## Round and colony rules

- New matches use individual pacing within the shared competition. Every learner
  receives every original question, in order, with a personal 25-second limit.
  A choice locks only after a durable server save. Correct answers immediately
  open that learner's upgrade choices; nobody waits for the class to answer.
- A correct answer earns one upgrade or eligible raid. Learners have up to 12
  seconds to choose; an unused choice becomes food. A normal upgrade has a
  2.5-second consequence scene; raids have 5.6 seconds for approach and return.
  The next question then opens automatically. Incorrect or unanswered questions
  show the correct answer and explanation for three seconds before continuing.
- Finished learners choose a colony to watch, without further upgrades or answers.
  Only that colony's visual state and relevant raid events are sent; rival answers
  stay private. The match ends after all active human learners finish, or when
  the teacher ends it. The teacher can pause everyone's questions and world time.
- Personal question time freezes on disconnection and resumes on reconnect.
  Existing saved matches retain their original synchronized pacing. Start a new
  multiplayer match to use individual pacing; smartboard pacing is unchanged.
- Workers forage without clicks. Rooms and walls require sticks/leaves. Guards
  unlock after two rooms, so longer question sets give more opportunity for raids.
- Drought, rain and birds follow the same shared seasonal clock. The drought
  consumes a target of 12 food, shortages slow gathering, rain restores gathering,
  and walls protect stores. No learner is eliminated.
- Raids use the existing guard/wall combat rules but transfer at most five food,
  leave at least three food with the defender, and protect the defender for
  20 active seconds. The same attacker cannot target that rival again for 60
  active seconds. Finished colonies cannot be raided.
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

The opening field guide introduces the rules before personal questions begin.
After that, encounters follow shared active world time (a target of 12 seconds
per question, at least 60 seconds), independent of any learner's progress.
Encounter animations do not block personal questions or add clicks. Pausing
freezes world time as well as personal timers. Encounters apply once and survive
reconnections. Faster games may finish before all scheduled encounters occur.
Eight or more questions schedule all six optional encounters; shorter games
schedule fewer discoveries alongside the seasonal threats.

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

### Rival selection, audio and activity feed

Correct answers still earn exactly one upgrade or raid. The learner upgrade panel now lists every active rival, including temporarily unavailable targets, with food, home guards, wall level and an eligibility/advantage message. The server rechecks eligibility at submission; the displayed forecast is not a guarantee if another action changes the colony first. Computer players select only allowed raids.

Multiplayer audio adds short original synthesized motifs for raid rally/clash/result, rain, birds, footsteps and other threats. The background playlist ducks during these cues. Sound defaults off, follows the music volume, and stops on mute, pause, hidden tab or disconnect. Replayed snapshots do not replay event sounds.

The teacher control room shows the latest 80 events with raid/meadow filters. Raid records retain names, food changes for both sides and guards converted to workers. Meadow events expand to show per-colony outcomes. Learners continue to receive only their own raid events; detailed logs are not added over their colony. The existing saved session report data also retains these event records.

### Rendering performance

ColonyScene caches the painted meadow/soil background, invalidating it for viewport changes, newly loaded images and season transitions. Decorative rendering is capped at 30fps (10fps for reduced motion); animation elapsed time remains time-based. Static scenes paint at most twice a second unless new state arrives, and hidden tabs do not paint. Sustained render costs above 18ms automatically reduce canvas pixel density to 1. Food-only updates refresh rival statistics without rebuilding the selection buttons. These reduce client work; local transport benchmarks do not establish performance on a school's Wi-Fi or learner hardware.

### Performance follow-up (14 October 2026)

- Broadcasts build the public class ranking once and reuse it for learner snapshots. Personal choices, correctness, upgrades and private raid evidence remain per learner.
- Answer and upgrade commands arriving within an 8 ms window are applied individually and committed together. A failed save rolls back the batch and rejects its acknowledgements; learners may retry. Every command still persists the full match before acknowledgement. The separate active-match pointer is only rewritten when the match changes, removing one redundant atomic file replacement from normal commands/ticks.
- Resource badges use a nearly opaque fill instead of five live backdrop blurs over the animated canvas, avoiding repeated compositor filtering.
- Local sprites (ant bodies, queen, chambers and creature frames) reuse size-quantised bitmaps. The cache is bounded to 80 entries and 4,194,304 pixels (approximately 16 MiB of pixel data), and is cleared when the scene is destroyed. Gait, construction, weather and interaction continue to animate.
- `node scripts/benchmark-colony-rendering.cjs` compares the HEAD renderer with the working tree in a synthetic mature-colony scene. It forces canvas readback; these figures are diagnostic, not FPS or a school hardware capacity guarantee. The first local comparison showed broadly unchanged median paint cost (~4.6 ms). A real classroom run is still needed to establish whether these changes address the reported lag.
- Existing socket tests exercise 30 simultaneous answers with durable acknowledgements, refresh/reconnection, raids, restart recovery and final reports. With an injected 40 ms write delay, a local burst of 30 answers required one match write and was acknowledged in approximately 64 ms. Local latency is not a measurement of school Wi-Fi or production disk performance.

### Individual pacing verification

- `tests/colonyquest-individual.test.js` covers immediate feedback, independent
  progress, missing answers, pause/restart, reconnect deadlines, spectators,
  full-question completion, shared threats and time-based raid protection.
- Socket tests include a 30-learner individual burst, durable personal phases,
  reconnecting at the saved question, and same-room spectator access restrictions.
- Browser checks exercise the real learner join/answer/upgrade/pause/reload/report
  flow on desktop and mobile, plus the spectator UI on Chromium, mobile and Safari.
- Final focused server run: 34 passed. Full repository run: 749 passed, one existing
  guest-practice markup assertion failed; the same failure was reproduced on the
  unchanged baseline commit. Syntax checks passed.
