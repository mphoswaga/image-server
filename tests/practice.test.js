const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-practice-'));
const practice = require('../practice');

const evidenceByStep = {
  'move-pointer': { action: 'pointer_enter', target: 'blue-star' },
  'single-click': { action: 'single_click', target: 'green-circle' },
  'double-click': { action: 'double_click', target: 'blue-folder' },
  'context-command': { action: 'context_command', target: 'archive-open' },
  'drag-drop': { action: 'drag_drop', target: 'homework-folder' },
  'scroll-find': { action: 'scroll_find', target: 'gold-star' },
  'copy-paste-menu': { action: 'context_copy_paste', target: 'relay-console' },
  'copy-paste': { action: 'copy_paste', target: 'relay-console' },
  'keyboard-defense': { action: 'type_word', target: 'byte-signal' },
  'copy-paste-shortcut': { action: 'shortcut_copy_paste', target: 'shortcut-console' },
  'key-patrol': { action: 'home_keys', target: 'home-row' },
  'word-blaster': { action: 'type_word', target: 'shield-word' },
  'capital-charge': { action: 'shift_letter', target: 'capital-signal' },
  'sentence-engine': { action: 'type_sentence', target: 'sentence-signal' },
  'repair-bay': { action: 'repair_word', target: 'repaired-code' },
};

function checkpoint(attempt, stepId, overrides = {}) {
  return practice.checkpointAttempt(attempt.id, attempt.studentId, {
    checkpointId: `${attempt.id}-${stepId}`,
    stepId,
    attempts: 1,
    hintsUsed: 0,
    activeSeconds: 8,
    evidence: evidenceByStep[stepId],
    ...overrides,
  });
}

test('catalog exposes the latest arcade activity without evidence secrets', () => {
  const activity = practice.listActivities().find((item) => item.id === 'g2-pointer-control');
  assert.equal(activity.id, 'g2-pointer-control');
  assert.equal(activity.version, 4);
  assert.equal(activity.gradeBand, 'Grades 2-3');
  assert.deepEqual(activity.steps.map((step) => step.id), [
    'move-pointer', 'single-click', 'double-click', 'context-command', 'drag-drop', 'scroll-find', 'copy-paste-menu', 'keyboard-defense',
  ]);
  assert.equal('action' in activity.steps[0], false);
  assert.equal('target' in activity.steps[0], false);
});

test('Grade 3 continues into its own recorded keyboard campaign', () => {
  const activity = practice.listActivities().find((item) => item.id === 'g3-keyboard-kingdom');
  assert.equal(activity.version, 2);
  assert.equal(activity.gradeBand, 'Grade 3');
  assert.deepEqual(activity.steps.map((step) => step.id), [
    'copy-paste-shortcut', 'key-patrol', 'word-blaster', 'capital-charge', 'sentence-engine', 'repair-bay',
  ]);
  const { attempt } = practice.createAttempt({ studentId: 'G3-1', studentName: 'Gina', activityId: activity.id });
  for (const step of activity.steps) checkpoint(attempt, step.id);
  assert.equal(practice.loadAttempt(attempt.id).status, 'completed');
});

test('an unfinished activity resumes instead of creating duplicate attempts', () => {
  const first = practice.createAttempt({ studentId: 'stu-1', studentName: 'Ama', activityId: 'g2-pointer-control' });
  const second = practice.createAttempt({ studentId: 'STU-1', studentName: 'Ama', activityId: 'g2-pointer-control' });
  assert.equal(first.resumed, false);
  assert.equal(second.resumed, true);
  assert.equal(second.attempt.id, first.attempt.id);
});

test('a learner cannot skip a skill or submit mismatched evidence', () => {
  const { attempt } = practice.createAttempt({ studentId: 'STU-2', studentName: 'Ben', activityId: 'g2-pointer-control' });
  assert.throws(() => checkpoint(attempt, 'double-click'), /Signal Trail/i);
  assert.throws(() => checkpoint(attempt, 'move-pointer', { evidence: { action: 'single_click', target: 'blue-star' } }), /could not be confirmed/i);
  assert.equal(practice.loadAttempt(attempt.id).currentStepIndex, 0);
});

test('checkpoints are idempotent and preserve the first result', () => {
  const { attempt } = practice.createAttempt({ studentId: 'STU-3', studentName: 'Chi', activityId: 'g2-pointer-control' });
  const first = checkpoint(attempt, 'move-pointer');
  const retry = practice.checkpointAttempt(attempt.id, attempt.studentId, {
    checkpointId: `${attempt.id}-move-pointer`,
    stepId: 'move-pointer', attempts: 9, hintsUsed: 5, activeSeconds: 99,
    evidence: evidenceByStep['move-pointer'],
  });
  assert.equal(first.idempotent, false);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.attempt.checkpoints.length, 1);
  assert.equal(retry.checkpoint.mastery, 'independent');
});

test('all eight ordered checkpoints complete the activity and calculate mastery', () => {
  const { attempt } = practice.createAttempt({ studentId: 'STU-4', studentName: 'Dara', activityId: 'g2-pointer-control' });
  checkpoint(attempt, 'move-pointer');
  checkpoint(attempt, 'single-click');
  checkpoint(attempt, 'double-click', { attempts: 3, hintsUsed: 1 });
  checkpoint(attempt, 'context-command');
  checkpoint(attempt, 'drag-drop');
  checkpoint(attempt, 'scroll-find');
  checkpoint(attempt, 'copy-paste-menu');
  const final = checkpoint(attempt, 'keyboard-defense');
  assert.equal(final.attempt.status, 'completed');
  assert.equal(final.attempt.currentStepIndex, 8);
  assert.equal(final.attempt.mastery, 'developing_independence');
  assert.ok(final.attempt.completedAt);
});

test('all legacy Foundation versions remain available for unfinished attempts', () => {
  const combinedClipboard = practice.getActivity('g2-pointer-control', 3);
  assert.equal(combinedClipboard.version, 3);
  assert.equal(combinedClipboard.steps.length, 8);
  const previous = practice.getActivity('g2-pointer-control', 2);
  assert.equal(previous.version, 2);
  assert.equal(previous.steps.length, 7);
  const legacy = practice.getActivity('g2-pointer-control', 1);
  assert.equal(legacy.version, 1);
  assert.equal(legacy.steps.length, 5);
});

test('the original Grade 3 campaign remains available for unfinished attempts', () => {
  const legacy = practice.getActivity('g3-keyboard-kingdom', 1);
  assert.equal(legacy.version, 1);
  assert.equal(legacy.steps.length, 5);
  assert.equal(legacy.steps.some((step) => step.id === 'copy-paste-shortcut'), false);
});

test('students cannot write checkpoints into another learner attempt', () => {
  const { attempt } = practice.createAttempt({ studentId: 'STU-5', studentName: 'Eli', activityId: 'g2-pointer-control' });
  assert.throws(() => practice.checkpointAttempt(attempt.id, 'STU-6', {
    checkpointId: 'foreign', stepId: 'move-pointer', attempts: 1, hintsUsed: 0, activeSeconds: 1,
    evidence: evidenceByStep['move-pointer'],
  }), /different learner/i);
});

test('teacher result filtering returns only roster-owned student IDs', () => {
  practice.createAttempt({ studentId: 'OWN-1', studentName: 'Owned', activityId: 'g2-pointer-control' });
  practice.createAttempt({ studentId: 'OTHER-1', studentName: 'Other', activityId: 'g2-pointer-control' });
  const results = practice.teacherResults(['own-1']);
  assert.deepEqual(results.map((result) => result.studentId), ['OWN-1']);
});

test('teacher preview is protected and explicitly avoids recorded attempts', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'image-server.js'), 'utf8');
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  const report = fs.readFileSync(path.join(__dirname, '..', 'practice-teacher.html'), 'utf8');
  assert.match(server, /app\.get\('\/practice\/preview', requirePracticeEnabled, requireAuth/);
  assert.match(server, /app\.get\('\/api\/practice\/preview', requirePracticeEnabled, requireAuth/);
  assert.match(player, /const ephemeralMode = previewMode \|\| guestMode/);
  assert.match(player, /if \(ephemeralMode\) return liveRoom \? saveLiveCheckpoint\(payload\) : saveEphemeralCheckpoint\(payload\)/);
  assert.match(player, /Preview only - results not saved/);
  assert.match(report, /href="\/practice\/preview"/);
  assert.match(report, /id="previewStageSelect"/);
  assert.match(report, /id="previewStageBtn"/);
  assert.match(player, /id="teacherStageJump"/);
  assert.match(player, /const requestedStageIndex = previewMode/);
  assert.match(player, /previewMode&&requestedStageIndex>=0\?requestedStageIndex:0/);
  assert.match(player, /\/practice\/preview\?\$\{world==='g3'/);
});

test('guest practice is public but never writes recorded student evidence', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'image-server.js'), 'utf8');
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  const start = fs.readFileSync(path.join(__dirname, '..', 'public', 'start.html'), 'utf8');
  const teacherLogin = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(server, /app\.get\('\/student\/practice\/guest', requirePracticeEnabled/);
  assert.match(player, /const guestMode = location\.pathname === '\/student\/practice\/guest'/);
  assert.match(player, /Guest play · Choose a class room or play on your own/);
  assert.match(player, /Solo guest play · Progress is not saved/);
  assert.match(player, /id="guestEntry"/);
  assert.match(player, /function joinLiveRoom\(\)/);
  assert.match(player, /function chooseSoloGuest\(\)/);
  assert.match(player, /const requestedContinue = query\.get\('continue'\) === '1'/);
  assert.match(player, /function continueWorldUrl\(\)/);
  assert.match(player, /\/student\/practice\/guest\?session=\$\{encodeURIComponent\(code\)\}&world=g3&continue=1/);
  assert.match(player, /continuingFoundationRoom=requestedContinue&&requestedWorld==='g3'/);
  assert.match(player, /body:JSON\.stringify\(\{\.\.\.payload,arcadeScore:performanceSummary\(\)\.score,activityId:ACTIVITY_ID,activityVersion:campaign\.version\}\)/);
  assert.match(start, /href="\/student\/practice\/guest">Practise without signing in/);
  assert.match(teacherLogin, /href="\/student\/practice\/guest">Student guest practice/);
  assert.match(teacherLogin, /if\(\$\('authGuestPractice'\)\) \$\('authGuestPractice'\)\.style\.display=d\.enabled\?'block':'none'/);
});

test('the learner quest keeps Byte and its connected game states', () => {
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  const byte = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'byte-talking.gif'));
  assert.equal(byte.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.match(player, /Byte's Skill Lab/);
  assert.match(player, /Byte and the Blackout/);
  assert.match(player, /Foundation World/);
  assert.match(player, /\/assets\/byte-talking\.gif/);
  assert.match(player, /mission-transition/);
  assert.match(player, /Signal Trail/);
  assert.match(player, /Message Relay/);
  assert.match(player, /Keyboard Kingdom/);
  assert.match(player, /id="scoreValue"/);
  assert.match(player, /id="accuracyValue"/);
  assert.match(player, /id="timeValue"/);
  assert.match(player, /arcade-grid/);
  assert.match(player, /burstParticles/);
  assert.match(player, /Combo/);
  assert.doesNotMatch(player, /phase === 'guided'/);
});

test('every Grade 2 district and finale uses its illustrated background', () => {
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  for (const asset of [
    'bg_byte_city_blackout.jpeg',
    'bg_signal_trail.jpeg',
    'bg_reactor_room.jpeg',
    'bg_vault_room.jpeg',
    'bg_command_deck.jpeg',
    'bg_cargo_station.jpeg',
    'bg_signal_tower.jpeg',
    'bg_message_relay.jpeg',
    'bg_sky_shield.jpeg',
    'bg_byte_city_restored.jpeg'
  ]) {
    assert.match(player, new RegExp(`/assets/practice/${asset}`));
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'practice', asset)), true);
  }
  for (const mission of ['move-pointer', 'single-click', 'double-click', 'context-command', 'drag-drop', 'scroll-find', 'copy-paste-menu', 'keyboard-defense']) {
    assert.match(player, new RegExp(`briefing-${mission}`));
  }
});

test('every Grade 2 mission keeps its arcade sprite asset', () => {
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  for (const asset of [
    'signal-bug.webp',
    'reactor-bug.webp',
    'vault-lock.webp',
    'archive-folder.webp',
    'power-crate.webp',
    'signal-antenna.webp',
    'message-packet.webp',
    'malware-meteor.webp'
  ]) {
    assert.match(player, new RegExp(`/assets/practice/sprites/${asset}`));
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'practice', 'sprites', asset)), true);
  }
});

test('every Grade 3 mission keeps its Keyboard Kingdom sprite asset', () => {
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  for (const asset of [
    'rapid-relay.webp',
    'home-row-console.webp',
    'code-ship.webp',
    'capital-tower.webp',
    'sentence-engine.webp',
    'repair-drone.webp'
  ]) {
    assert.match(player, new RegExp(`/assets/practice/sprites-g3/${asset}`));
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'practice', 'sprites-g3', asset)), true);
  }
});

test('Grade 2 play uses animated demonstrations and save-before-auto-advance', () => {
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  assert.match(player, /function tutorialVisual\(stepId\)/);
  assert.match(player, /Watch Byte/);
  assert.match(player, /function signalTrail\(slot\)/);
  assert.match(player, /function reactorBoard\(slot\)/);
  assert.match(player, /class=\"tower-floor\"/);
  assert.match(player, /function scheduleAutoAdvance\(\)/);
  assert.match(player, /setTimeout\(advanceAfterCheckpoint,2600\)/);
  assert.match(player, /localStorage\.removeItem\(checkpointKey\(\)\);\s*setSave\('Progress saved'\);\s*scheduleAutoAdvance\(\)/);
  assert.match(player, /if \(ephemeralMode\) return liveRoom \? saveLiveCheckpoint\(payload\) : saveEphemeralCheckpoint\(payload\)/);
});

test('both arcade worlds provide sustained, varied practice', () => {
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  assert.match(player, /const missionGoals = PracticeScoring\.missionGoals/);
  assert.match(player, /'BUG'.*'BYTE'.*'CODE'.*'POWER'.*'CASTLE'.*'SIGNAL'.*'KEYBOARD'/s);
  assert.match(player, /class="blaster-shield"/);
  assert.match(player, /Boss wave/);
  assert.match(player, /Type the first letter to <b>lock a ship<\/b>/);
  assert.match(player, /target\.dataset\.word\.startsWith\(key\)/);
  assert.match(player, /classList\.add\('locked'\)/);
  assert.match(player, /\['BYTE','STAR','CODE','POWER','SHIELD'\]/);
  assert.match(player, /\['I CAN CODE\.','BYTE IS READY\.'\]/);
  assert.match(player, /\['PEN','PIN'\],\['DOG','DIG'\]/);
  assert.match(player, /About 25–30 minutes/);
  assert.match(player, /About 22–25 minutes/);
});

test('the arcade result factors accuracy, mistakes and active time into its score', () => {
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  const teacher = fs.readFileSync(path.join(__dirname, '..', 'practice-teacher.html'), 'utf8');
  assert.match(player, /src="\/practice-scoring\.js"/);
  assert.match(player, /id="accuracyValue"/);
  assert.match(player, /id="timeValue"/);
  assert.match(player, /correctInputs:stats\.correctInputs/);
  assert.match(player, /mistakes:stats\.mistakes/);
  assert.match(player, /Final score/);
  assert.match(player, /Accuracy<strong>/);
  assert.match(player, /Mistakes<strong>/);
  assert.match(player, /Active time<strong>/);
  assert.match(teacher, /accurate · \$\{mistakes\} mistakes/);
});

test('learner results explain strengths and give mission-specific next steps', () => {
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  assert.match(player, /id="learnerCoaching"/);
  assert.match(player, /What went well/);
  assert.match(player, /What to practise next/);
  assert.match(player, /Your mission report/);
  assert.match(player, /const improvementTips = \{/);
  assert.match(player, /checkpoint\.mistakes/);
  assert.match(player, /checkpoint\.hintsUsed/);
  assert.match(player, /renderLearnerCoaching\(performance,attempt\.checkpoints/);
  assert.match(player, /renderLearnerCoaching\(me\?/);
});

test('teacher evidence stays hidden until the teacher chooses View progress', () => {
  const teacher = fs.readFileSync(path.join(__dirname, '..', 'practice-teacher.html'), 'utf8');
  assert.match(teacher, /id="toggleProgressBtn"[^>]*aria-expanded="false"/);
  assert.match(teacher, /id="progressPanel" hidden/);
  assert.match(teacher, /opening\?'Hide progress':'View progress'/);
});

test('a learner cannot send overlapping live-room join requests that strand gameplay', () => {
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  assert.match(player, /let joiningLiveRoom = false/);
  assert.match(player, /if\(joiningLiveRoom\) return;\s*joiningLiveRoom=true/);
  assert.match(player, /finally \{ joiningLiveRoom=false; \}/);
});

test('Grade 2 Message Relay uses a consistent right-click Copy and Paste menu', () => {
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  assert.match(player, /window\.getSelection\(\)/);
  assert.match(player, /id="relayCopyMenu"/);
  assert.match(player, /id="relayPasteMenu"/);
  assert.match(player, /source\.addEventListener\('contextmenu'/);
  assert.match(player, /destination\.addEventListener\('contextmenu'/);
  assert.match(player, /relayCopyCommand/);
  assert.match(player, /relayPasteCommand/);
  assert.match(player, /This mission uses the right-click Copy and Paste menu/);
});

test('mission changes remove stale game-area click handlers before highlighting', () => {
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  assert.match(player, /if \(taskAreaClickHandler\) area\.removeEventListener\('click',taskAreaClickHandler\)/);
  assert.match(player, /if \(taskAreaPointerDownHandler\) area\.removeEventListener\('pointerdown',taskAreaPointerDownHandler\)/);
  assert.match(player, /taskAreaClickHandler = null/);
  assert.match(player, /taskAreaPointerDownHandler = null/);
});

test('Grade 3 Rapid Relay requires copy and paste keyboard shortcuts', () => {
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  assert.match(player, /shortcut && key==='c'/);
  assert.match(player, /shortcut && key==='v'/);
  assert.match(player, /document\.activeElement!==destination/);
  assert.match(player, /Use the paste shortcut instead of typing the message again/);
  assert.match(player, /Use \$\{modifier\}\+C for the Grade 3 speed mission/);
  assert.match(player, /Use \$\{modifier\}\+V for the Grade 3 speed mission/);
});
