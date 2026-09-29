// Evidence summaries only: exclude unfinished rounds and keep later checks separate.
function summarize(report) {
 const questions=report.rounds.map((q,index)=>{
  const cells=report.students.map(s=>({id:s.id,name:s.name,...s.rounds[index]})).filter(a=>a.expected);
  const answered=cells.filter(a=>a.initialCorrect!==null),wrong=cells.filter(a=>a.revisedCorrect===false),missing=cells.filter(a=>a.initialCorrect===null);
  const count=key=>cells.filter(a=>a[key]===true).length;
  const choices={};for(const a of wrong)choices[a.revised]=(choices[a.revised]||0)+1;
  return {...q,index,expected:cells.length,answered:answered.length,firstCorrect:count('initialCorrect'),finalCorrect:count('revisedCorrect'),wrong:wrong.length,missing:missing.length,improved:cells.filter(a=>a.initialCorrect===false&&a.revisedCorrect===true).length,regressed:cells.filter(a=>a.initialCorrect===true&&a.revisedCorrect===false).length,commonWrong:Object.entries(choices).sort((a,b)=>b[1]-a[1]).map(([answer,count])=>({answer,count})),needsSupport:wrong.map(a=>({id:a.id,name:a.name})),noResponse:missing.map(a=>({id:a.id,name:a.name}))};
 });
 const original=questions.filter(q=>q.completed&&!q.followUp),later=questions.filter(q=>q.completed&&q.followUp);
 const sum=key=>original.reduce((n,q)=>n+q[key],0);
 const learners=report.students.map(st=>{
  const cells=original.map(q=>st.rounds[q.index]).filter(a=>a.expected);
  return {id:st.id,name:st.name,expected:cells.length,answered:cells.filter(a=>a.initialCorrect!==null).length,firstCorrect:cells.filter(a=>a.initialCorrect===true).length,finalCorrect:cells.filter(a=>a.revisedCorrect===true).length,improved:cells.filter(a=>a.initialCorrect===false&&a.revisedCorrect===true).length,wrong:cells.filter(a=>a.revisedCorrect===false).length,missing:cells.filter(a=>a.initialCorrect===null).length};
 });
 return {questions,original,later,learners,totals:{questions:original.length,participants:learners.filter(l=>l.answered).length,roster:learners.length,answered:sum('answered'),expected:sum('expected'),firstCorrect:sum('firstCorrect'),finalCorrect:sum('finalCorrect'),improved:sum('improved'),regressed:sum('regressed'),missing:sum('missing')},priorities:original.filter(q=>q.wrong||q.missing).sort((a,b)=>b.wrong/Math.max(1,b.answered)-a.wrong/Math.max(1,a.answered)||b.missing-a.missing)};
}
module.exports={summarize};
