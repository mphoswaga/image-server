# Class team setup

New real MoonQuest duels start with sign-in closed. Teachers review a two-column name table, move learners between sides, and mark absences. Confirm teams & open sign-in saves class membership separately from the match and opens the existing name/PIN journey. The smartboard lists present learners before they sign in. Practice sessions and existing sessions retain their prior access behavior.

Class profiles use teacher/class-scoped hashed filenames under DATA_DIR/class-game-teams. Saved membership is reused in subsequent MoonQuest duels. Where no profile exists, existing ColonyQuest configurations/sessions are examined using learner IDs and teacher ownership. Two-team membership is preserved; unmatched learners get a suggested side and a review count. More than two saved teams requires review rather than silently merging them. Without saved membership, the existing balanced random assignment is offered once; shuffle is allowed before sign-in opens.

Attendance uses reversible per-match removal. Absent learners cannot join and are hidden on the public board and name picker, while they remain in the roster and saved team profile. A new match starts with everyone included. Save updated teams persists any later lobby changes. Existing results and active sessions are not migrated or rewritten.

The Grade 3B4 team profile was created on 30 September 2026 at the user's request with 25 learners split 13/12. Names and IDs are not committed to source control. A printable table was delivered separately. The new UI requires deployment before that saved profile is used by the live app.
