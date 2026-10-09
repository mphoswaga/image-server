# School newsletters

Open `/newsletters.html` (Newsletters in the LessonScope menu).

## Workflow

1. Existing teachers create a school/team newsletter workspace and add a class/week, sending date and subjects.
2. Coordinator invites colleagues by exact sign-in email and assigns teacher subjects, translator or coordinator role. Copy/send links manually; no outbound email is sent. Pending invitations can be withdrawn and members removed.
3. Teachers write, upload a lesson plan (existing validated document parser), select an owned saved LessonScope plan, or reuse an existing same-subject contribution from another class/week. AI drafts remain editable until saved/submitted.
4. Assistants draft/edit Vietnamese and mark reviewed after English submission.
5. Coordinator saves an example and minimum counts, optionally regenerates selected/all subjects into a preview, then explicitly applies it. No model output silently replaces source content.
6. All subjects must be submitted and translated/reviewed before approval. Print / Save PDF uses the browser print dialogue with an A4 stylesheet; unapproved exports are labelled DRAFT.

New accounts created after their newsletter invitation receive newsletter-only access on acceptance. Existing accounts keep their previous entitlement. The server restricts focused accounts to authentication and newsletter routes; they cannot read rosters, marks, games or lesson-workspace APIs. They can upload/paste a plan. Existing full accounts can choose only their own saved plans. Workspace membership is invitation-based, not inferred from an email domain or browser-supplied organization ID. Workspace display names do not assert verified school affiliation.

## Data and consistency

- Atomic JSON persistence in `DATA_DIR/school-newsletters/<uuid>.json`; existing volume backups include it.
- All reads require membership; writes validate role and assigned subject. Students cannot join.
- Revision checks prevent silent concurrent overwrites, including after AI calls. Reload and review local draft text after a conflict.
- English edits invalidate Vietnamese review; content edits invalidate approval.
- Save/apply/restore keeps history. Retain 50 unapproved versions plus all approved snapshots; restoring also archives the current version.
- Character counts use Unicode code points, include interior whitespace and exclude leading/trailing whitespace. Submission and approval enforce minima; drafts and AI previews may be shorter.
- Local text recovery is keyed by user/workspace/report and never substitutes for server submission.
- Free AI action: `lessonscope.school_newsletter`; cost is tracked but no wallet reservation or credit deduction. Shared generation limiter applies.
- No public report links, automatic parent sending or student information in this workspace.

## Validation and limits

Unit/API tests cover membership, email-matched invites, role/subject restrictions, concurrent edits, counts, review invalidation, previews, restore, and malformed AI output. Browser tests cover desktop/mobile/Safari, upload, focused accounts, edit recovery, approval and printable layout. AI responses are deterministic test doubles; actual model quality and the production sign-in flow still require a release smoke test.

The print layout is a new clean bilingual report; exact school PDF branding awaits a final parent PDF sample. No live Google Sheets synchronization or import of historical workbook newsletters is included. The supplied 3B2 workbook informed the class/week/subject workflow; it is not modified.
