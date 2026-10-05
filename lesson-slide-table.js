// Conservative fit estimate for the native table area. Visual release checks
// still render PowerPoint: this prevents known dense-cell overflow at runtime.
function wrappedLines(value, capacity) {
  let lines=1, used=0;
  for(const word of String(value || '').split(/\s+/).filter(Boolean)) {
    if(word.length>capacity) { if(used){lines++;used=0;} lines+=Math.floor((word.length-1)/capacity);used=((word.length-1)%capacity)+1; }
    else if(used && used+1+word.length>capacity){lines++;used=word.length;}
    else used+=word.length+(used?1:0);
  }
  return lines;
}
function tableLayout(table) {
  if(!Array.isArray(table?.headers)||table.headers.length<2||table.headers.length>4||!Array.isArray(table.rows)||!table.rows.length||table.rows.length>8||table.rows.some(r=>!Array.isArray(r)||r.length!==table.headers.length)) throw new Error('Use 2–4 table columns and 1–8 matching rows.');
  const rows=[table.headers,...table.rows], height=3.1;
  for(let fontSize=18;fontSize>=14;fontSize--) {
    const capacity=Math.floor(((9/table.headers.length)*72-12)/(fontSize*.56));
    const rowH=rows.map(row=>(Math.max(...row.map(cell=>wrappedLines(cell,capacity)))*fontSize*1.18+6)/72);
    const total=rowH.reduce((a,b)=>a+b,0);
    if(total<=height)return {fontSize,rowH:rowH.map(h=>h+(height-total)/rows.length),height};
  }
  throw new Error('This table is too dense to read. Shorten its cells or use fewer rows.');
}
module.exports={tableLayout};
