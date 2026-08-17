# LessonScope Version History

Application rollback is available to administrators from **Admin > Updates and rollback**.
The panel reads recent commits from GitHub and creates a new rollback commit; it never
force-pushes and never rewinds teacher data on the persistent volume.

## 2026-08-17 - Protected application rollback

- Adds admin-only release history and rollback controls.
- Requires a private Railway verification code and repository-scoped GitHub token.
- Restricts rollback targets to recent commits on the configured branch.
- Creates a normal GitHub commit so Railway deploys through the established pipeline.

## 2026-08-13 - Multiple lesson-plan templates

- Keeps multiple named week-by-week workbooks for different grades and classes.
- Lets teachers select which workbook receives generated lessons.
- Preserves existing workbook data during migration.

## 2026-08-12 - Guided planning and assistant

- Adds the guided LessonScope assistant and expanded workflow guidance.
- Improves success criteria, teaching-model detail, and lesson-sequence planning.
