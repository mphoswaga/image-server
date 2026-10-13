# School newsletters

Open `/newsletters.html` (Newsletters in the LessonScope menu).

## Workflow

1. Existing teachers create a school/team newsletter workspace and add a class/week, sending date and subjects.
2. Coordinator invites colleagues by exact sign-in email and assigns teacher subjects, translator or coordinator role. Copy/send links manually; no outbound email is sent. Pending invitations can be withdrawn and members removed.
3. Teachers write, upload a lesson plan (existing validated document parser), select an owned saved LessonScope plan, or reuse an existing same-subject contribution from another class/week. AI drafts remain editable until saved/submitted.
4. Assistants draft/edit Vietnamese and mark reviewed after English submission.
5. Coordinator saves an example and minimum counts, optionally regenerates selected/all subjects into a preview, then explicitly applies it. No model output silently replaces source content.
6. All subjects must be submitted and translated/reviewed before approval. PDF preview and download use the same server-rendered PDF; unapproved exports are labelled DRAFT.

New accounts created after their newsletter invitation receive newsletter-only access on acceptance. Existing accounts keep their previous entitlement. The server restricts focused accounts to authentication and newsletter routes; they cannot read rosters, marks, games or lesson-workspace APIs. They can upload/paste a plan. Existing full accounts can choose only their own saved plans. Workspace membership is invitation-based, not inferred from an email domain or browser-supplied organization ID. Workspace display names do not assert verified school affiliation.

## Data and consistency

- Atomic JSON persistence in `DATA_DIR/school-newsletters/<uuid>.json`; existing volume backups include it.
- Workspace reads require membership; writes validate role and assigned subject. Public readers receive only the explicitly published snapshot. Students cannot join workspaces.
- Revision checks prevent silent concurrent overwrites, including after AI calls. Reload and review local draft text after a conflict.
- English edits invalidate Vietnamese review; content edits invalidate approval.
- Save/apply/restore keeps history. Retain 50 unapproved versions plus all approved snapshots; restoring also archives the current version.
- Character counts use Unicode code points, include interior whitespace and exclude leading/trailing whitespace. Submission and approval enforce minima; drafts and AI previews may be shorter.
- Local text recovery is keyed by user/workspace/report and never substitutes for server submission.
- Free AI action: `lessonscope.school_newsletter`; cost is tracked but no wallet reservation or credit deduction. Shared generation limiter applies.
- No automatic parent sending or student information in this workspace.

## Validation and limits

Unit/API tests cover membership, email-matched invites, role/subject restrictions, concurrent edits, counts, review invalidation, previews, restore, and malformed AI output. Browser tests cover desktop/mobile/Safari, upload, focused accounts, edit recovery, approval and printable layout. AI responses are deterministic test doubles; actual model quality and the production sign-in flow still require a release smoke test.

The PDF offers standard and school-branded bilingual layouts. No live Google Sheets synchronization or import of historical workbook newsletters is included. The supplied 3B2 workbook informed the class/week/subject workflow; it is not modified.

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

## Parent reading page

Coordinators approve a report, then select **Publish parent newsletter** under
**Share with families**. Copy the parent link to share manually. The responsive
page needs no login, offers subject shortcuts, expandable reading sections,
English/Vietnamese switching and a PDF download using the published snapshot.

Publishing stores only school/class/week/date, design and approved subject text.
Teacher identities, invitations, history and draft content are not exposed. The
unpredictable capability stays in the URL fragment and is sent in an Authorization
header; responses are not cached or indexed. Anyone holding the link can read it.
Links have no time expiry. Republish keeps the link, while **Revoke link** invalidates
it; publishing afterwards creates a new link. Draft edits never update the public
version until the coordinator approves and republishes. Revocation cannot retract
already downloaded PDFs.

## Weekly organisation and class delivery

- Weekly progress lists each class/subject and defaults to the selected week. Teachers and translators get **My contributions**, filtered by their subjects and class assignments. Clicking a task opens its contribution.
- **Set up next week** copies selected classes and subjects into blank reports, retaining workspace staff assignments. Duplicate class/week creation is rejected atomically. Set a submission deadline and sending date; deadlines after sending dates are rejected.
- **Class assignments** scopes existing teachers/translators to selected class names. Legacy memberships keep all-class access until explicitly changed. Server checks cover editing, AI generation and cross-class copying. These scopes control contribution responsibility; workspace members can still read other reports.
- **Copy a saved subject to other classes** previews the exact saved English. Applying requires confirmation, preserves target history, clears approval/submission and requires translation review again. Existing public snapshots remain unchanged.
- Vietnamese review stores the English reviewed at that time. Later English edits display changed/added and removed lines. Older records without a baseline cannot reconstruct a precise comparison until a new review (or a change from a currently reviewed contribution).
- Readiness lists missing submission/review and character-minimum issues with links to the relevant subject. Missing sending dates are advisory. Dates do not cause automatic sending or reminders.
- **Preview on a phone** renders saved draft text using the parent reader inside a phone-width frame without publishing it. No public capability is created for draft previews.
- **Permanent class link** is created after the first publication. It resolves to the latest published sending date (publication date when absent) and offers only published editions. Withdrawing a weekly publication removes it from this archive. Class-link revocation is independent of previously shared weekly links. There is no expiry. Class identity uses the existing class name; use consistent names across weeks.

## Coordinator reports and subject media

**Coordinator reports** offers all contributions, submitted, not submitted, outstanding translation review, overdue, awaiting approval/publication and unassigned subjects. Filter by class and week, then run the report and download its CSV. The API requires coordinator membership. Assigned teachers and actual submitters are separate fields; historical submissions without recorded attribution show “Not recorded”. Overdue includes outstanding submission or review after the deadline, using the school timezone (Asia/Ho_Chi_Minh). CSV values are quoted and formula-leading text is escaped.

Subject teachers/coordinators can add up to eight labelled HTTP(S) links and three PNG/JPEG/WebP images through **Links and images**. Images are resized client-side and decoded/re-encoded server-side with pixel and size limits; remote image URLs and arbitrary HTML are not accepted. Captions accompany images in both language views. Media drafts recover locally where browser storage permits; media edits invalidate submission, translation review and approval. Publication snapshots preserve their media until explicitly republished or revoked. Images also appear in phone previews, parent readers and PDFs; PDF links are clickable.

Image bytes are stored under `DATA_DIR/school-newsletters/media` with immutable SHA-256 filenames; report/history snapshots keep references. Include this folder in backups. It has no unauthenticated static route. Removing an image from a draft does not erase older approved/history copies or previously downloaded PDFs.

### Weekly overview and family checklist

The coordinator's Weekly progress view is a class-by-subject matrix, filtered by week. Cells open the relevant contribution and distinguish missing text, draft, submitted English, reviewed translation and approval. Assigned teachers respect subject and class scope. Selected outstanding contributions can receive in-app reminders; these appear when staff open the workspace and do not send email.

Coordinators can request a subject revision with private feedback. This clears submission, review and approval for the current draft while leaving the last published edition unchanged. Resubmitting English resolves the feedback request. Feedback and reminders are excluded from the public snapshot.

The family reader collects explicitly headed sections from the selected language of the published newsletter: Homework, Things to bring, Important dates and Conversation starters (also How can you help at home?). Matching Vietnamese headings are supported. Details go directly below the heading, ending at a blank line or next heading. No dates or tasks are inferred. If no matching sections exist, the checklist is hidden. Ticks are local to the current visit, are not sent to school, and are scoped to edition, class and text. Draft phone previews use the same reader. Existing PDF content is unchanged.

## Staff email notifications and TA publishing

Assigned translators (TAs) may approve and publish completed newsletters for their assigned classes, obtain the parent link, and revoke it. Every subject still needs submitted English and reviewed Vietnamese meeting the configured minimum. Teachers cannot publish; TAs cannot edit English or publish another class. Coordinators retain oversight without being a required approval step.

Coordinators open **Email notifications** in the class newsletter to choose Off, Test or Live, and set the weekly summary weekday and time (Asia/Ho_Chi_Minh, UTC+7). The default is Off. Test routes all notifications to the configuring coordinator's account email; demos cannot enable Live. Preview sends nothing. The explicit test button sends one combined sample to the current coordinator only. Actual delivery requires RESEND_API_KEY and verified EMAIL_FROM in hosting; this feature never uses the development email logging fallback.

A minute-based application worker groups newly submitted, unreviewed contributions per assigned TA. It excludes submissions predating mode activation; previews include current pending work. Coordinator summaries list unfinished reports, missing subjects/assigned teachers, pending translations and reports ready to publish. Coordinators receive one scheduled summary per local date, not per-submission emails. Parent messages and invitation emails are not sent by this feature. Publishing still provides a link for staff to share themselves.

Settings and delivery history persist in newsletter-notifications.json on the application's data volume. Successful notices are deduplicated across restarts; transient failures retry with the same provider idempotency key for up to 23 hours while still relevant. Ambiguous older attempts stop for provider inspection. The worker assumes the existing single-process persistent-volume deployment. It reserves at most 90 new newsletter deliveries in a rolling 24 hours, leaving some of the free provider allowance for account messages; this is not a guarantee against traffic from other applications on the same provider account. An offline server resumes a weekly summary later on the scheduled local day; it does not backfill missed days.
