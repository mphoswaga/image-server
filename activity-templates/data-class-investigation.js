const fair = require('./data-school-fair-mission');

const [desk, types, repair, files, ladder, count, decision] = fair.sections;

function station(id,title,objectiveIds,instructions,prompt,activity) {
  const marks = activity.inputs.reduce((sum,input) => sum + input.marks,0);
  return {id,title,objectiveIds,instructions,type:'practical',items:[{id:id+'-task',prompt,marks,activity}]};
}
function onePerResponse(section) {
  const item = section.items[0];
  const inputs = item.activity.inputs.map(input => ({...input,marks:1}));
  return {...section,items:[{...item,marks:inputs.length,activity:{...item.activity,inputs}}]};
}
const entry = (label,row,column,accepted,marks=1) => ({label,row,column,entry:'text',accepted,marks});
const pick = (label,options,correct,marks=1) => ({label,options,accepted:[correct],marks});

const filing = station('paper-register','From paper to screen',['records','quality'],
  'The paper slips are out of order. Match the slip number before entering each detail. Keep any zero at the start.',
  'Update the digital borrowing register from two paper slips.',{
    kind:'data-organise',version:1,source:['Slip 026 · Hoàng An · Book B07 · Room 008','Slip 062 · Mai Chi · Book B70 · Room 080'],
    table:[['Slip','Borrower','Book code','Room'],['062','Mai Chi','',''],['026','','','008']],
    inputs:[entry('Book for slip 062',1,2,['B70']),entry('Room for slip 062',1,3,['080']),
      entry('Borrower on slip 026',2,1,['Hoàng An','Hoang An']),entry('Book for slip 026',2,2,['B07'])],
  });

const stock = station('stock-sheet','Update the stock sheet',['records','information'],
  'Use the letter at the top and the number on the left to find a cell. Count what is still on each shelf.',
  'Finish the stock check and sign off on the booth that needs more kits.',{
    kind:'data-organise',version:1,presentation:'worksheet',
    source:['Stock check · Kits left = kits packed minus kits used.','Restock rule · Send extra kits to the booth with the fewest kits left.'],
    table:[['Booth','Packed','Used','Left'],['Art','12','8',''],['Games','14','8',''],['Music','10','7',''],
      ['Restock booth','','Evidence cell','']],
    inputs:[entry('D2 · Art kits left',1,3,['4']),entry('D3 · Games kits left',2,3,['6']),entry('D4 · Music kits left',3,3,['3']),
      entry('Booth to restock',4,1,['Music']),entry('Address of the cell that supports your choice',4,3,['D4'])],
  });

const packing = station('storage','Pack the fair folder',['sizes','information'],
  'Use 1 MB = 1,000 KB and 1 GB = 1,000 MB. A shared folder has 1 GB free. The fair team must save the video and the poster first.',
  'Work out the space left, then choose a recording that fits.',{
    kind:'data-interpret',version:1,presentation:'types',table:[['File','Size'],['Show video','970 MB'],['Door poster','8,000 KB'],['Long recording','24 MB'],['Short recording','20,000 KB']],
    inputs:[pick('How many MB does the poster use?',['80 MB','8 MB','800 MB'],'8 MB'),
      pick('Space left after the video and poster',['22 MB','30 MB','12 MB'],'22 MB'),
      pick('Which recording can you add?',['Long recording','Both recordings','Short recording'],'Short recording'),
      pick('How much space remains after adding that recording?',['200 KB','2,000 KB','20,000 KB'],'2,000 KB')],
  });

const sections = [
  {...desk,instructions:'These fictional pupils are volunteering at the fair. Enter one pupil per row. Copy the family contact numbers exactly.'},
  onePerResponse(types), filing, onePerResponse(repair), stock, onePerResponse(files), ladder, packing,
  onePerResponse(count), onePerResponse(decision),
];
module.exports = {...fair,title:'School Fair Data Lab · The fair investigation',sections,
  instructions:'Run ten fair stations. Use the paper slips, digital register, stock sheet and media folder. Finish by counting votes and advising the organisers.',
  totalMarks:sections.flatMap(s => s.items).reduce((sum,item) => sum + item.marks,0)};
