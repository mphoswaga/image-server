# UI language support

The first rollout covers learner entry (/start, /join, /play), assignment entry/submission, and the teacher games/roster workspace. It does not translate authored questions, answers, titles, names, generated resources or game narration. Other product screens remain English until explicitly integrated.

- `public/locales/vi.js` contains English UI keys and Vietnamese translations. English is the fallback.
- `public/ui-language.js` exposes `LessonScopeI18n.t(key, values)` and `bind(element, key, values)` for parameterised UI text. `bind` renders with textContent, never HTML.
- Mark a fixed UI text element with `data-ui-i18n`; only its direct text nodes are translated. Mark placeholder inputs with `data-ui-placeholder`.
- The per-template dynamic selector list must contain only known UI controls. Never add learner names, uploaded content, questions, answer choices, or general content containers.
- Preserve explicit option values and stable IDs. Application logic must use these, not translated labels.
- Language is saved in the current browser, with cross-tab synchronisation. It does not change the account, lesson content, grading or API payloads.
- The language picker must remain available in both languages. Do not translate its native language names.

Browser checks: `tests/e2e/ui-language.spec.js` tests navigation persistence, form preservation, dynamic errors, English fallback and untouched names/titles. `games-welcome.spec.js` checks the games-only sharing UI in Vietnamese.
