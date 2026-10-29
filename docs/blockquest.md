# BlockQuest

Open My games → Choose a game → BlockQuest on an existing multiple-choice question set. Choose Smartboard for two teams, or Single-player mission for teacher practice. Learners find BlockQuest in the existing Play menu after joining their assigned question set.

Smartboard shuffles the selected roster into two teams, alternates team turns and cycles through every member of a team before reshuffling. Without a roster, it uses anonymous players and does not record learner marks. Single-player learner sessions are private to the game and authenticated learner; teacher single-player previews do not save learner marks.

A correct answer unlocks three distinct shapes. Choose, rotate and move a block using touch or keyboard (left/right, up to rotate, Enter to place). The ghost previews a gravity placement. Placed blocks earn 10 game points and each full row earns 100. A one-second presentation precedes the next turn. Incorrect answers reveal the correct answer and explanation without awarding a block. No falling timer or automatic answer timeout is used. If none of the offered shapes can fit, a rescue clears the bottom three rows without awarding points. Solo ends on three cleared rows or the last question; smartboard ends on the last question or teacher Finish. Teacher pause and refresh resume are supported.

Sessions and original question snapshots are persisted under DATA_DIR/blockquest. The server validates identity, phase, revision, answer choice and placement. Answer keys are not sent ahead of feedback. Earned game points are separate from correct/attempted learning results. Named learner evidence uses original question indices and idempotent run/student result IDs. Completion integrates with the existing game results and gradebook pipeline.

Validation: node --test tests/blockquest.test.js; npx playwright test tests/e2e/blockquest.spec.js --project=windows-100 --project=mobile. Browser checks cover smartboard and solo flows, replay protection, resume, learner-only control boundaries, private sessions and persisted learning results. Classroom trials and direct smartboard hardware testing are still needed before claiming classroom readiness.
