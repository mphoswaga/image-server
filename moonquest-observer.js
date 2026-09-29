// Explicit, aggregate-only projection. Never serialize a teacher report to a shared link.
const crypto = require('crypto');
const { summarize } = require('./moonquest-report');
const digest = token => crypto.createHash('sha256').update(token).digest('hex');
function observerService(store, clock = Date.now) {
  function issue(id, teacherId) {
    const s = store.session(id);
    if (s.teacherId !== teacherId) throw Error('Session not found for this teacher.');
    const token = crypto.randomBytes(32).toString('hex');
    s.observer = { hash: digest(token), expiresAt: clock() + 12 * 60 * 60 * 1000 };
    store.saveSession(s);
    return { token, expiresAt: s.observer.expiresAt };
  }
  function revoke(id, teacherId) {
    const s = store.session(id);
    if (s.teacherId !== teacherId) throw Error('Session not found for this teacher.');
    delete s.observer; store.saveSession(s);
  }
  function read(id, token) {
    const s = store.session(id), grant = s.observer;
    if (!grant || grant.expiresAt <= clock() || !/^[a-f0-9]{64}$/.test(token || '') ||
      !crypto.timingSafeEqual(Buffer.from(grant.hash, 'hex'), Buffer.from(digest(token), 'hex'))) throw Error('This report link has expired or been withdrawn. Ask the teacher for a new link.');
    const live = store.snapshot(id, 'board');
    const report = store.report(id, s.teacherId), summary = summarize(report);
    const rounds = summary.questions.filter(q => q.completed).map(q => ({
      number:q.number, prompt:q.prompt, concept:q.concept, followUp:q.followUp,
      expected:q.expected, answered:q.answered, firstCorrect:q.firstCorrect, finalCorrect:q.finalCorrect,
      wrong:q.wrong, missing:q.missing, improved:q.improved, regressed:q.regressed,
      commonWrong:q.commonWrong, extraTimeUsed:q.extraTimeUsed,
      meetingStarted:!!q.classMeetingStartedAt, meetingContinued:!!q.classMeetingContinuedAt,
    }));
    return { title:live.title, test:live.test, phase:live.phase, paused:live.paused,
      teachingPause:live.teachingPause, updatedAt:clock(), expiresAt:grant.expiresAt,
      joined:live.joined, expected:live.expected, answered:live.answered, round:live.round+1,
      question:live.question ? {prompt:live.question.prompt, concept:live.question.concept} : null,
      extraTimeUsed:live.extraTimeUsed, totals:summary.totals, rounds };
  }
  return { issue, revoke, read };
}
module.exports = { observerService };
