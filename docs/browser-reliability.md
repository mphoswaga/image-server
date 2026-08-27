# Browser Reliability Checks

## Purpose

The Playwright suite protects LessonScope's highest-risk responsive and
navigation surfaces from regressions that are difficult to reproduce on a
developer's screen.

## Run the checks

Install browser runtimes once after installing dependencies:

```sh
npx playwright install chromium webkit
```

Run browser tests only:

```sh
npm run test:e2e
```

Run the complete release gate:

```sh
npm run check:release
```

## Current coverage

- Signed-out guest practice entry.
- Grade 3 practice entry and first mission launch.
- Teacher lesson-source, learning-content, and lesson-setup wizard pages.
- Desktop navigation clickability and account-control separation.
- Roster upload actions remaining visible and separated.
- Horizontal overflow checks on every covered viewport.
- Keyboard-only navigation through the teacher menu, roster uploader, and
  lesson wizard.
- Pixel baselines for planning and roster layouts on Windows desktop and small
  mobile.
- A real teacher-and-learner classwork session covering lobby wait, synchronized
  start, timer visibility, learner score privacy, and teacher end-game
  propagation in Chromium and WebKit.
- EducScope shared-cookie authentication for both authenticated and signed-out
  visitors using a local account-service double.
- Lesson and slide generation, reviewed-plan handoff, PowerPoint download, and
  Google Slides export using deterministic external-service responses.

The matrix uses Chromium at three common Windows effective resolutions,
touch-enabled tablet and mobile profiles, and desktop WebKit as the Safari
engine check. Tests run serially because the current JSON data store does not
provide safe concurrent writes; that limitation is addressed in Phase 4 of the
stability roadmap.

The automated suite never spends AI credits and never signs into production
EducScope or Google accounts. After deployment, manually smoke-test one real
EducScope login, one small generation, one PowerPoint download, and one Google
Slides export before enabling a wider rollout.

## Failure artifacts

Playwright retains a trace, screenshot, and video when a test fails. Open the
HTML report with:

```sh
npx playwright show-report
```

The geometry helpers include the offending element names and dimensions in the
test error so responsive failures can be diagnosed without guessing.
