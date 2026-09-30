// Explicit, aggregate-only projection. Never serialize a teacher report to a shared link.
const crypto = require('crypto');
const { summarize } = require('./moonquest-report');
const digest = token => crypto.createHash('sha256').update(token).digest('hex');
function observerService(store, clock = Date.now) {
  function issue(id, teacherId) {
    const s = store.session(id);
    if (s.teacherId !== teacherId) throw Error('Session not found for this teacher.');
    const token = crypto.randomBytes(32).toString('hex');
    s.observer = { hash: digest(token), expiresAt: null };
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
    if (!grant || !/^[a-f0-9]{64}$/.test(token || '') ||
      !crypto.timingSafeEqual(Buffer.from(grant.hash, 'hex'), Buffer.from(digest(token), 'hex'))) throw Error('This report link is invalid or has been withdrawn. Ask the teacher for a new link.');
    const live = store.snapshot(id, 'board');
    const report = store.report(id, s.teacherId), summary = summarize(report);
    const rounds = summary.questions.filter(q => q.completed).map(q => ({
      number:q.number, prompt:q.prompt, concept:q.concept, followUp:q.followUp,
      assessed:q.assessed, expected:q.expected, answered:q.answered, firstCorrect:q.firstCorrect, finalCorrect:q.finalCorrect,
      wrong:q.wrong, missing:q.missing, improved:q.improved, regressed:q.regressed,
      commonWrong:q.commonWrong.filter(c=>c.answer!=='Teacher checked: incorrect'), extraTimeUsed:q.extraTimeUsed,
      meetingStarted:!!q.classMeetingStartedAt, meetingContinued:!!q.classMeetingContinuedAt,
    }));
    // Share only assessed evidence, never private annotations or internal learner IDs.
    const sharedReport={title:report.title,className:report.className,test:report.test,createdAt:report.createdAt,phase:report.phase,
      rounds:report.rounds.map(q=>({number:q.number,prompt:q.prompt,concept:q.concept,followUp:q.followUp,completed:q.completed,extraTimeUsed:q.extraTimeUsed,classMeetingStartedAt:q.classMeetingStartedAt,classMeetingContinuedAt:q.classMeetingContinuedAt})),
      students:report.students.map((st,i)=>({id:'learner-'+(i+1),name:st.name,rounds:st.rounds.map((a,j)=>({expected:a.expected,initialCorrect:report.rounds[j].completed?a.initialCorrect:null,revisedCorrect:report.rounds[j].completed?a.revisedCorrect:null}))}))};
    sharedReport.summary=summarize(sharedReport);
    for(const q of sharedReport.summary.questions)q.commonWrong=[];
    delete sharedReport.summary.totals.adjusted;
    for(const q of sharedReport.summary.questions)delete q.adjusted;
    for(const l of sharedReport.summary.learners)delete l.adjusted;
    return { report:sharedReport, title:live.title, test:live.test, phase:live.phase, paused:live.paused,
      teachingPause:live.teachingPause, updatedAt:clock(), expiresAt:null,
      joined:live.joined, expected:live.expected, answered:live.answered, round:live.round+1,
      question:live.question ? {prompt:live.question.prompt, concept:live.question.concept} : null,
      extraTimeUsed:live.extraTimeUsed, totals:Object.fromEntries(['questions','participants','roster','answered','assessed','expected','firstCorrect','finalCorrect','improved','regressed','missing'].map(key=>[key,summary.totals[key]])), rounds };
  }
  return { issue, revoke, read };
}
module.exports = { observerService };
