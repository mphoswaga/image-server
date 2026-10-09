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

## Teacher preview and demos

- **Teacher preview** shows saved subject content read-only. It does not impersonate another account or change permissions.
- **Preview PDF** generates an actual A4 PDF on the authenticated server, embeds it in a dialog, and offers the same bytes for download or opening separately. It uses bundled, OFL-licensed Noto Sans fonts for Vietnamese. Membership and the shared generation rate limit protect this endpoint.
- **Try a sample demo** is available to signed-in staff, including newsletter-only members. Every person gets their own reusable demo workspace with fictional ICT, Maths and Science contributions. It cannot invite other people; it does not touch a real report.
- The demo can simulate coordinator, ICT teacher and translator screens. Role switching is only a UI rehearsal inside the owner's demo, never a permission change. Reset demo restores the examples and settings. Generation deliberately uses fixed samples rather than live AI, as stated in the demo banner.
- Demo PDF downloads remain labelled DEMO even after approval. Real unapproved PDFs remain labelled DRAFT.

### School PDF design

Under **Coordinator desk → Format and minimum length → PDF design**, select
**Vinschool · Cambridge weekly report** and save. This uses the supplied school
logo, navy/gold title, blue subject bands and Letter portrait page size. Longer
English/Vietnamese contributions continue on additional pages with repeated
school and subject headings. The LessonScope design remains the default.
Both PDF actions now open the same server-rendered PDF; the downloaded bytes
match the preview. Draft and demo labels are retained.

The publishing overview shows class/week, submission/review progress and a PDF
preview action. Subject rows expand to edit and retain their open state within
the browser session. Assigned teachers' subjects open automatically. Coordinator
settings are under **Manage workspace**; regeneration/history are under **Report
tools and previous versions**. The teacher preview has English/Vietnamese options.

Sample demos now default to the Vinschool design, including older demos that
never selected a PDF design. Real school workspaces retain their selected design;
coordinators can use **Use Vinschool design** beside **Preview PDF** to save that
choice and immediately open the branded PDF. This display-only change preserves
contributions, translation reviews and approval.
