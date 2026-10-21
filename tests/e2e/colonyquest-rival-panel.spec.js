const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { ColonyMatch } = require('../../colonyquest-multiplayer');
function fixture() {
  const m = new ColonyMatch(
    {
      id: 'rivals',
      lessonTitle: 'Rivals',
      questions: [{ question: 'Choose A', options: ['A', 'B'], correctIndex: 0 }],
    },
    { storyEnabled: false, now: Date.now() },
  );
  for (let i = 0; i < 25; i++) m.join({ studentId: 's' + i, name: 'Learner ' + i }, Date.now());
  m.start(Date.now());
  const [a, b] = m.active();
  a.colony.soldiers = 4;
  for (const p of m.active()) m.answer(p.id, 0, 0, Date.now());
  m.state.phase = 'upgrade';
  m.state.deadline = Date.now() + 600000;
  return { m, a, b };
}
test('all rivals are readable, one click sends target, teacher sees complete raid effect', async ({
  page,
}, info) => {
  const { m, a, b } = fixture();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/colonyquest-live-play/rivals', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: fs.readFileSync('public/colonyquest-live.html', 'utf8'),
    }),
  );
  await page.route('**/api/game/rivals/colonyquest-live/ticket', (r) =>
    r.fulfill({ json: { token: 'test' } }),
  );
  await page.addInitScript(
    (snapshot) => {
      window.WebSocket = class {
        static OPEN = 1;
        constructor() {
          this.readyState = 1;
          window.testSocket = this;
          setTimeout(() => this.onopen?.(), 0);
        }
        send(raw) {
          const msg = JSON.parse(raw);
          if (msg.type === 'auth')
            this.onmessage({
              data: JSON.stringify({ type: 'state', state: snapshot }),
            });
          else window.lastCommand = msg;
        }
        close() {}
      };
    },
    m.snapshot(a.id, false, Date.now()),
  );
  await page.goto('/colonyquest-live-play/rivals');
  await expect(page.locator('.raid-target')).toHaveCount(24);
  await expect(page.locator('.raid-target').first()).toContainText('Wall 1');
  await expect(page.locator('.raid-target').first()).toContainText('guards');
  await page.screenshot({
    path: info.outputPath('rival-panel.png'),
    fullPage: true,
  });
  await page.locator('.raid-target').first().click();
  expect(await page.evaluate(() => lastCommand.type)).toBe('upgrade');
  expect(await page.evaluate(() => lastCommand.key)).toBe('raid');
  expect(await page.evaluate(() => lastCommand.target)).toBe(b.id);
  m.upgrade(a.id, 0, 'raid', b.id, Date.now());
  await page.route('**/colonyquest-live/rivals', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: fs.readFileSync('public/colonyquest-live.html', 'utf8'),
    }),
  );
  await page.route('**/api/game/rivals/colonyquest-live', (r) =>
    r.fulfill({
      json: {
        title: 'Rivals',
        classes: [],
        rosterIds: [],
        history: [],
        attendance: [],
        match: m.snapshot(null, true, Date.now()),
      },
    }),
  );
  await page.goto('/colonyquest-live/rivals');
  await expect(page.locator('#activityLog')).toContainText('Learner 0 → Learner 1');
  await expect(page.locator('#activityLog')).toContainText('Raider: +5 food · Defender: -5 food');
  await page.locator('#activityFilter').selectOption('story');
  await expect(page.locator('#activityLog')).toContainText('No events');
  await page.locator('#activityFilter').selectOption('raid');
  await expect(page.locator('#activityLog')).toContainText('Raid succeeded');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#activityPanel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('raid-timeline.png') });
  expect(errors).toEqual([]);
});
test('event audio deduplicates snapshots and stops scheduled cues on mute', async ({ page }) => {
  await page.goto('/healthz');
  await page.addScriptTag({ url: '/colonyquest-event-audio.js' });
  const result = await page.evaluate(() => {
    const audio = new ColonyEventAudio();
    const cues = [];
    audio.play = (...x) => cues.push(x);
    const old = { id: 'a', events: [] };
    audio.update(old, null, false);
    const next = {
      id: 'a',
      me: { id: 'defender' },
      events: [{ id: 'raid1', kind: 'raid', success: false, target: 'defender' }],
    };
    audio.update(next, old, false);
    audio.update(next, next, false);
    let stopped = 0;
    audio.nodes = [
      {
        stop() {
          stopped++;
        },
      },
    ];
    audio.configure(false, 1);
    return { cues, stopped };
  });
  expect(result.cues).toEqual([['raid', true, 8400]]);
  expect(result.stopped).toBe(1);
});
