# Live observer view

In signed-in MoonQuest teacher controls, choose **Share observer link**. Copy the link from the dialog. The observer needs no account. They see a brief introduction, then choose **View live learning**. The intro does not stop the session and can be reopened.

Links expire after 12 hours. Creating a new link replaces the previous one; **Withdraw observer link** revokes the active link. Only a hash of the 256-bit random token is persisted. The token travels in the URL fragment (not query/logs/referrers), then an Authorization header. Observer requests cannot issue teacher commands. Invalid links receive a generic 403; dashboard content is cleared on revocation. Temporary connection errors display a stale-data warning and retry.

The endpoint uses an explicit aggregate allowlist over the existing report summary. It never returns learner names/IDs, teacher reflections, room or board tokens, future questions, or unrevealed answer choices/correctness. Participation is live; evidence includes only revealed rounds. First encounters and later checks remain distinct. Unanswered responses are not counted as incorrect. Multiple-choice scoring is inherited from the existing game/report logic. Refresh interval is 2.5 seconds, with only one request at a time.

Language is based on the supplied Danielson staff CPD and 2026–27 observation rubric: 3a Communicating about Purpose and Content, 3b Using Questioning and Discussion Techniques, 3d Using Assessment for Learning, 3e Responding Flexibly to Student Needs, and 4a Engaging in Reflective Practice. Narrative is deterministic and evidence-based: no AI latency, charges, invented observations, causal claims or teaching ratings. Discussion quality and intellectual engagement require classroom observation. Speed bonuses are not assessment evidence.

Automated tests cover capability rotation/expiry/revocation/ownership, pre-reveal privacy, report agreement, and a signed-out browser journey with live changes and denied teacher commands. The observer UI is responsive and includes textual equivalents of charts.
