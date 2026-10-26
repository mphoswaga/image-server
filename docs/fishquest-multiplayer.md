# FishQuest multiplayer: ongoing challenges

Whales begin at 800 size and keep that form (hunger never takes a whale below 800). Two connected, unoccupied whales within 150 world units receive the same question. Each submits independently, receives 75 game points for a correct answer, and returns to swimming immediately. Both can win; speed is not scored. An answered challenge starts a 15-second challenge cooldown. The crown marks whales with the highest positive count of correct whale/pearl challenges, including ties.

Every learner gets a pearl question after 45 seconds without a new challenge. It waits until the learner is available and awards 35 game points and 20 size for a correct answer, up to the existing size cap. An unpaired whale can therefore keep answering. Questions use the existing least-presented selection; whale partners receive the initiating learner's selected question. Normal encounters, game length, teacher pause and teacher end remain available. Questions have the existing 30-second deadline. Unanswered deadlines count as timeout; teacher-end/disconnect cancellation is not marked incorrect. Marks use the existing first graded attempt per question policy, separate from game points.

## Performance

New clients negotiate `foodDeltas` on WebSocket authentication. The first state and each reconnect contain full food; subsequent packets carry only removals and changed rows. A server baseline advances only when a packet is accepted by the transport. Legacy clients still receive full food. Answers broadcast immediately. Saves triggered in one simulation tick are combined, while answers outside a tick still persist before acknowledgement.

The renderer avoids snapping on encounter locks, preserves leaderboard DOM when rank/name do not change, and avoids forced layout for score pulses. Decorative animation is skipped outside the viewport; movement remains authoritative. Slow frames sustained for two seconds reduce bubbles and decorative updates; ten seconds of faster frames restore full effects. Next-stage textures are prepared in idle callbacks near evolution thresholds. Reduced-motion preferences remain respected.

## Verification

Use `node --test tests/fishquest*.test.js` and the FishQuest motion/recovery Playwright tests. Tests cover 25 whales (including an unpaired learner), independent scoring, duplicate answers, pause, expiry, disconnect, end, delta reconnects/backpressure baselines, real WebSockets, and the renderer with 30 fish and 871 plankton. Local simulations do not establish classroom network performance.
