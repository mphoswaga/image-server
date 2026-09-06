# Multiplayer reliability

## Current division of work

FishQuest runs authoritative movement, collisions, plankton collection, NPC
decisions, answers, scores, pause and deadlines on the server. Each browser
renders the world, generates fish textures, interpolates movement, animates fins
and bubbles, plays audio, and updates its countdown. These visual effects need
no server messages of their own. Moving scores or collision outcomes into the
browser would allow conflicting results and tampering.

The Practice Arcade already runs its individual stages on the learner device.
Its server validates checkpoints and controls live-room start, pause and end.
Its live-room refresh already has a single-flight guard and request timeout.

## Reliability changes

- FishQuest movement commands run at 10 Hz instead of 20 Hz; the 20 Hz server
  simulation and client animation remain independent. Input expires after
  400 ms if the device stops sending commands.
- Running rooms broadcast at 10 Hz; lobby, paused and ended rooms at 1 Hz.
  Shared player and food arrays are built once per broadcast, with private
  questions and learning results added separately for each learner.
- Outgoing queues above 128 KiB drop obsolete state updates. A connection
  congested for 10 seconds is terminated so it can reconnect to fresh state.
- Incoming messages are capped at 4 KiB and 80 messages per second per socket.
  Invalid JSON, null and array messages are discarded. Socket error events and
  send failures are contained rather than escaping into the server process.
- Replaced sockets stop accepting commands immediately. The replaced browser
  displays an explanation and does not reconnect automatically.
- Reconnection has exponential delay with jitter, offline detection, stale
  socket guards and a 12-second state watchdog. HTTP requests time out after
  10 seconds. Reconnect attempts reset only after receiving game state.
- Hidden or unfocused browsers clear held movement keys. Hidden pages stop
  sending movement commands. Client send queues are bounded as well.
- Student and teacher countdowns compensate for device clock differences.
  A paused question uses the refreshed server deadline when play resumes.
- Optional audio and visual failures do not prevent the question UI updating.
- Result persistence retries every 5 seconds after failure. The saved marker
  is rolled back if writing that marker fails. Existing result IDs prevent
  repeated successful writes from duplicating a learner's result.
- Finished browsers close their socket after confirmed result persistence.
  Completed rooms with saved results and no clients leave the in-memory map.
- Teacher polling cannot overlap a prior poll and each request has a timeout.

## Verification

`node --test tests/fishquest-live-transport.test.js` opens 30 real WebSocket
connections on an isolated local server. It exercises malformed and oversized
messages, player replacement, pause/resume, match end and a temporary result
storage failure followed by a successful automatic retry.

`node --test tests/fishquest-transport.test.js tests/fishquest.test.js` covers
slow consumers, send exceptions, message limits, private snapshot isolation,
simulation, answer idempotency, disconnects and NPC interactions.

`npx playwright test tests/e2e/fishquest-recovery.spec.js --project=windows-100`
checks the browser connection state machine and question timer using controlled
sockets and time. It does not measure rendering performance or real Wi-Fi.

## Deployment limits and next measurements

The current match authority is in one Node.js process. Run a single web
process; adding replicas requires a shared room owner and routing strategy.
Persisted running rooms currently end on process restart. This change does not
provide seamless recovery across a deployment or machine failure.

Match saves still use synchronous atomic files on the configured persistent
volume. A blocked or failing volume remains a possible source of latency or
room termination. Before increasing concurrent class capacity, measure event
loop delay, storage latency, resident memory, outbound bytes and snapshot age
under the actual hosting plan, with multiple 30-learner rooms.

If storage becomes the measured bottleneck, move persistence to an ordered
asynchronous writer with explicit durability acknowledgments and restart
recovery tests. If simulation becomes the bottleneck, assign rooms to workers
or a dedicated realtime service while keeping one authority per room. Do not
introduce Redis or extra replicas without ownership and reconnect routing.

Production acceptance should include two physical learner computers through
the classroom network, temporary Wi-Fi loss, a background tab, a duplicate tab,
wrong answers, teacher pause/resume, timer expiry and verified saved reports.
No finite test suite can establish that a game will never crash.
