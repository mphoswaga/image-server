const header = ['Name', 'Date of birth', 'Age', 'Cellphone number'];
const records = [
  ['Mia', '10 January 2017', '9', '000 000 0001'],
  ['Leo', '20 January 2018', '8', '000 000 0002'],
];
const table = [header, ...records];
const source = records.map(([name, birthday, age, phone]) => `Name: ${name} · Date of birth: ${birthday} · Age: ${age} · Cellphone number: ${phone}`);
const response = (label, options, answer, marks) => ({label, options, accepted:[answer], marks});
const edit = (row, column, input, initial) => ({ ...input, row, column, ...(initial ? {initial} : {}) });
const values = column => records.map(record => record[column]);
const organise = [
  edit(0,2,response('Heading for years old',header,'Age',2)),
  edit(0,3,response('Heading for the phone number',header,'Cellphone number',2)),
  ...records.flatMap((record,index)=>record.map((value,column)=>edit(index+1,column,
    response(`Card ${index+1}: ${header[column]}`,values(column),value,2)))),
];
const correct = [
  edit(1,2,response('Fix Mia’s age',['Ten',...values(2)],'9',5),'Ten'),
  edit(2,1,response('Fix Leo’s date of birth',values(1),records[1][1],5),records[0][1]),
  edit(2,3,response('Fix Leo’s cellphone number',values(3),records[1][3],5),records[0][3]),
];
function item(id, prompt, kind, inputs, showCards) {
  const display = table.map((row,y)=>row.map((value,x)=>inputs.some(input=>input.row===y&&input.column===x)?'':value));
  return {id,prompt,marks:inputs.reduce((sum,input)=>sum+input.marks,0),
    activity:{kind,version:1,table:display,inputs,source:showCards?source:[]}};
}
module.exports = {
  title:'Everyday Data · Contact cards',subject:'ICT',grade:'Grade 3',assessmentType:'project',deliveryMode:'live',
  totalMarks:50,instructions:'Use the pretend contact cards. Do not enter your own details.',
  objectives:[
    {id:'table',text:'Organise fields, records and values in a table'},
    {id:'types',text:'Choose appropriate values for date, text and number fields'},
    {id:'information',text:'Find and compare information in a table'},
  ],
  sections:[
    {id:'organise',title:'Fill in the table',type:'practical',objectiveIds:['table'],instructions:'Read the cards. Use Card 1 for the first row and Card 2 for the second.',
      items:[item('arrange','Choose the headings and fill the empty cells.','data-organise',organise,true)]},
    {id:'correct',title:'Fix the table',type:'practical',objectiveIds:['table','types'],instructions:'Use the cards to fix three entries. Write ages as numbers.',
      items:[item('repair','Fix Mia’s age and the two wrong details for Leo.','data-correct',correct,true)]},
    {id:'use',title:'Read the table',type:'practical',objectiveIds:['table','information'],instructions:'Use this correct table to answer.',
      items:[
        item('find','Find a person and read a detail.','data-find',[
          response('Who is 8 years old?',values(0),'Leo',5),
          response('What is Mia’s cellphone number?',values(3),records[0][3],5),
        ]),
        item('interpret','Compare their ages.','data-interpret',[
          response('Who is older?',values(0),'Mia',5),
        ]),
      ]},
  ],
};
