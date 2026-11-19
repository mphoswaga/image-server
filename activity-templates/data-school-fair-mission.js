const previous = require('./data-school-fair-order');

const [registration, types, repair, media, ladder] = previous.sections;
const helpers = [
  ['Mia Tran','9','12 May 2017','12/05/2017','000 000 0001'],
  ['Leo Vu','8','7 June 2018','07/06/2018','000 000 0002'],
  ['An Le','9','24 March 2017','24/03/2017','000 000 0003'],
];
const headers = ['Name','Age','Date of birth','Phone'];
const badge = ([name, age, birth,, phone]) => [name,'Age ' + age,'Born ' + birth,'Phone ' + phone].join(' · ');
const choice = (label, options, accepted, marks) => ({label, options, accepted:[accepted], marks});
const ballots = ['Games','Music','Art','Games','Art','Games','No booth selected','Music','Games','Art','Music','Games'];
const slips = ballots.map((vote, i) => 'Slip ' + String(i + 1).padStart(2,'0') + ' · ' + vote);
function station(section, prompt, activity) {
  const marks = activity.inputs.reduce((sum, field) => sum + field.marks, 0);
  return {...section, items:[{id:section.id + '-task',prompt,marks,activity}]};
}
function reweight(section, points) {
  const {prompt,activity} = section.items[0];
  return station(section,prompt,{...activity,inputs:activity.inputs.map((input,i) => ({...input,marks:points[i]}))});
}

const sections = [
  station({...registration,instructions:'Work from left to right through the three fictional badges. Enter one helper per row. Keep the first zeroes in each phone number.'},
    'Make a register the fair helpers can use.',{
      kind:'data-organise',version:1,presentation:'records',source:helpers.map(badge),
      table:[headers,...helpers.map(() => headers.map(() => ''))],
      inputs:helpers.flatMap(([name,age,birth,shortDate,phone],i) => {
        const [day,month,year] = shortDate.split('/');
        const keys = [[name],[age],[birth,shortDate,Number(day)+'/'+Number(month)+'/'+year,year+'-'+month+'-'+day],[phone,phone.replaceAll(' ','')]];
        return headers.map((header,j) => ({label:'Helper '+(i+1)+' · '+header,row:i+1,column:j,entry:'text',accepted:keys[j],marks:1}));
      }),
    }),
  reweight(types,[1,1,1,1,1]),
  station({...repair,instructions:'Compare each cell with the helper’s badge. If the badge leaves something blank, choose a way to check it.'},
    'Repair the art helper’s record and decide what to do about the missing age.',{
      ...repair.items[0].activity, table:[['Name','Tickets','Visit date','Phone','Age'],['An','','','','']],
      source:['An · 3 tickets · Visit on 12 May · Phone 000 000 0003 · Age left blank'],
      inputs:[...repair.items[0].activity.inputs.map((input,i) => ({...input,marks:[2,1,2][i]})),
        {...choice('Age',['0','9','Ask the helper'],'Ask the helper',1),initial:'0',row:1,column:4}],
    }),
  station(media,'Choose a poster that fits the upload limit and work out the space left.',{
    ...media.items[0].activity,inputs:[{...media.items[0].activity.inputs[0],label:'Which file can you send as the poster?',accepted:['Art poster.png']},...media.items[0].activity.inputs.slice(1)],
  }),
  ladder,
  station({id:'count',title:'Count the ballots',type:'practical',objectiveIds:['records','quality'],
    instructions:'Each visitor received one slip. Count each marked vote once. Record slips with no booth selected separately.'},
    'Build a tally from the voting slips.',{
      kind:'data-organise',version:1,presentation:'ballots',source:slips,
      table:[['Booth or slip','Your count'],['Art',''],['Games',''],['Music',''],['No booth selected','']],
      inputs:['Art','Games','Music','No booth selected'].map((label,i) => ({
        label:label+' count',row:i+1,column:1,entry:'text',accepted:[String(ballots.filter(v => v === label).length)],marks:[2,2,2,1][i],
      })),
    }),
  station({id:'decision',title:'Advise the organisers',type:'practical',objectiveIds:['information'],
    instructions:'Use the same slips to build a recommendation. The organisers have one extra table to give away.'},
    'Which booth should get the extra table? Back your choice with the votes.',{
      kind:'data-interpret',version:1,presentation:'ballots',source:slips,
      table:[['Decision','Fair rule'],['One extra table','Give it to the booth with the most votes.']],
      inputs:[choice('How many votes named a booth?',['10','11','12'],'11',2),
        choice('Give the extra table to…',['Art','Games','Music'],'Games',2),
        choice('My evidence is…',['Games had 5 votes. Art and Music each had 3.','Games had 5 votes. Art and Music each had 4.','Twelve slips were handed in.'],'Games had 5 votes. Art and Music each had 3.',2),
        choice('What can the organisers say about the blank slip?',['The visitor voted for Art.','The visitor did not choose a booth.','The visitor disliked the fair.'],'The visitor did not choose a booth.',2)],
    }),
];
module.exports = { suggestedMinutes:60,...previous,title:'School Fair Data Lab · Run the fair',sections,
  instructions:'Register the helpers, check the files and count the votes. At the end, use the evidence to help the organisers decide.',
  totalMarks:sections.flatMap(section => section.items).reduce((sum,task) => sum + task.marks,0)};
