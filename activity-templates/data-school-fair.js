// A fictional school fair gives each database skill a reason to use it.
const choice = (label, options, answer, marks, position = {}) => ({
  label, options, accepted: [answer], marks, ...position,
});
function station(id, title, objective, instructions, prompt, kind, presentation, table, inputs, source = []) {
  return { id, title, type: 'practical', objectiveIds: [objective], instructions,
    items: [{ id: id + '-task', prompt, marks: inputs.reduce((sum, item) => sum + item.marks, 0),
      activity: { kind, version: 1, presentation, table, inputs, source } }] };
}

const types = ['Text', 'Number', 'Date', 'Yes / No'];
const sections = [
  station('desk','Registration desk','records','Two helpers have arrived. Use their badges to complete the sign-in sheet.',
    'Put each detail in the right record.', 'data-organise','records',
    [['Name','Age','Date of birth','Phone'],['Mia','','12 May 2017',''],['Leo','','','000 000 0002']],
    [choice('Mia’s age',['8','9'],'9',2,{row:1,column:1}),
     choice('Mia’s phone',['000 000 0001','000 000 0002'],'000 000 0001',2,{row:1,column:3}),
     choice('Leo’s age',['8','9'],'8',2,{row:2,column:1}),
     choice('Leo’s date of birth',['12 May 2017','7 June 2018'],'7 June 2018',2,{row:2,column:2})],
    ['Mia · Age 9 · 12 May 2017 · 000 000 0001','Leo · Age 8 · 7 June 2018 · 000 000 0002']),
  station('types','Field designer','types','Choose the data type that belongs to each field.',
    'Design the fair’s ticket database.', 'data-find','types',
    [['Field','Example'],['Name','Mia'],['Tickets bought','3'],['Visit date','12 May'],['Paid?','Yes']],
    [choice('Name',types,'Text',2),choice('Tickets bought',types,'Number',2),
     choice('Visit date',types,'Date',2),choice('Paid?',types,'Yes / No',2),
     choice('Which value belongs in Tickets bought?',['Tomorrow','Five friends','5'],'5',2)]),
  station('repair','Record repair','quality','The sign-in sheet has three mistakes. Check the badge before you fix them.',
    'Correct the record for the art helper.', 'data-correct','records',
    [['Name','Tickets','Visit date','Phone'],['An','','','']],
    [choice('Tickets must be a number',['Three','3','30'],'3',3,{row:1,column:1,initial:'Three'}),
     choice('Visit date',['13 May','12 May','20 May'],'12 May',3,{row:1,column:2,initial:'13 May'}),
     choice('Keep all the digits in the phone number',['3','000 000 0003','000 000 0030'],'000 000 0003',2,{row:1,column:3,initial:'3'})],
    ['An · 3 tickets · Visit on 12 May · Phone 000 000 0003']),
  station('files','Media desk','sizes','The fair team needs to send a poster. The upload limit is 5 MB.',
    'Inspect the files and choose what to send.', 'data-interpret','files',
    [['File','Size'],['Welcome note.txt','4 KB'],['Art poster.png','3 MB'],['Fair video.mp4','18 MB']],
    [choice('Which file is the smallest?',['Art poster.png','Welcome note.txt','Fair video.mp4'],'Welcome note.txt',3),
     choice('Which file is too large to upload?',['Welcome note.txt','Fair video.mp4','Art poster.png'],'Fair video.mp4',3),
     choice('How much space is left from the 5 MB limit after adding the poster?',['2 MB','8 MB','2 KB'],'2 MB',3),
     choice('Which pair puts the smaller unit first?',['MB then KB','GB then MB','KB then MB'],'KB then MB',3)]),
  station('votes','Results booth','information','Each visitor voted for one booth. Read the totals to help plan next year’s fair.',
    'Turn the votes into information the organisers can use.', 'data-interpret','survey',
    [['Booth','Votes'],['Art','8'],['Games','12'],['Music','5']],
    [choice('Which is one raw count from the survey?',['Games received 12 votes','Games was the most popular booth','Music was the least popular booth'],'Games received 12 votes',3),
     choice('Which conclusion is supported by the counts?',['Music was the favourite','Games was the most popular','Art and Games tied'],'Games was the most popular',3),
     choice('How many more votes did Games get than Art?',['20','4','7'],'4',3),
     choice('Which decision uses this information?',['Give Games more space next year','Order 12 microphones','Cancel the fair'],'Give Games more space next year',3)]),
];
module.exports = { title:'School Fair Data Lab',subject:'ICT',grade:'Grade 3',assessmentType:'project',deliveryMode:'live',
  instructions:'Help run the school fair. Use the fictional records, files and votes to complete each station.',
  objectives:[['records','Organise fields and records'],['types','Match fields and values to data types'],
    ['quality','Check data against a source'],['sizes','Compare file sizes and storage units'],
    ['information','Distinguish data from information and draw a conclusion']].map(([id,text])=>({id,text})),
  sections,totalMarks:sections.reduce((sum,s)=>sum+s.items[0].marks,0) };
