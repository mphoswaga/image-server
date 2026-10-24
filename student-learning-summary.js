// Comments describe positive, completed evidence only. Zero is never a next-step signal.
function learningSummary(activities) {
  const completed = (activities || []).filter(a => ['Marked', 'Completed'].includes(a.status)
    && Number.isFinite(Number(a.score)) && Number(a.score) > 0
    && Number.isFinite(Number(a.total)) && Number(a.total) >= Number(a.score));
  const items = completed.flatMap(a => (a.evidence || []).filter(e =>
    e.score !== null && e.score !== '' && Number.isFinite(Number(e.score)) && Number(e.score) > 0
    && Number.isFinite(Number(e.total)) && Number(e.total) >= Number(e.score)
    && String(e.item || '').trim()).map(e => ({ label: String(e.item).trim(), ratio: Number(e.score)/Number(e.total), activity: a.key })));
  // Use activity titles only when no question-level evidence was recorded at all.
  const evidence = items.length ? items : completed.filter(a => !(a.evidence || []).length)
    .map(a => ({label: a.title, ratio:Number(a.score)/Number(a.total), activity:a.key})).filter(e=>e.label);
  if (!evidence.length) return { text: 'There is not enough completed, positively scored work to describe strengths and next steps yet.', evidenceCount: 0, sources: [] };
  const ordered = [...evidence].sort((a,b)=>b.ratio-a.ratio);
  const strongest = [...new Set(ordered.slice(0,2).map(e=>e.label))];
  const developing = [...evidence].filter(e=>e.ratio<0.8).sort((a,b)=>a.ratio-b.ratio)[0];
  const quote = label => '“' + label + '”';
  const strengths = 'In completed work, the strongest recorded results are in ' + strongest.map(quote).join(' and ') + '.';
  const next = developing ? ' A useful next step is to build on the partial success in ' + quote(developing.label) + ' through further practice.'
    : ' To build on this success, practise applying the same skills in a new task.';
  return { text: strengths + next, evidenceCount: evidence.length, sources: [...new Set(evidence.map(e=>e.activity))] };
}
module.exports = { learningSummary };
