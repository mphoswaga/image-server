// All records are fictional. The displayed conversion guide uses decimal storage units.
function dataPracticeLevels(topic) {
  function quiz(instructions,presentation,table,questions) {
    return {instructions,activity:{presentation,table,inputs:questions.map(([label,...options])=>({label,options}))},
      keys:questions.map(([,answer])=>[answer])};
  }
  function records(instructions,source,headers,rows,fields) {
    return {instructions,activity:{presentation:'records',source,table:[headers,...rows],
      inputs:fields.map(([row,column,,initial])=>({label:headers[column]+' · row '+row,row,column,entry:'text',initial}))},
      keys:fields.map(([, ,answer])=>[answer])};
  }
  function ladder(instructions,sorted) {
    return {instructions,activity:{presentation:'order',table:[['File'],...[2,0,3,1].map(i=>[sorted[i]])],
      inputs:sorted.map((_,i)=>({label:'Position '+(i+1)}))},keys:sorted.map(v=>[v])};
  }
  const badges=['Nguyễn Minh Anh · Age 8 · Room B04 · Phone 000 000 0021','Trần Gia Bảo · Age 9 · Room A12 · Phone 000 000 0012'];
  const files=[['File','Size'],['Welcome note.txt','200 KB'],['Art poster.png','2 MB'],['Fair video.mp4','750 MB']];
  const guide='Use 1 MB = 1,000 KB and 1 GB = 1,000 MB.';
  const types=[['Field','Example'],['Room number','B04'],['Number of chairs','24'],['Booked?','No']];
  const votes=[['Club','Votes'],['Chess','9'],['Music','7'],['Art','5']];
  switch(topic) {
    case 'Make a record': return [
      records('Use both badges. Match each name to its room and age.',badges,['Name','Room','Age'],[['Trần Gia Bảo','',''],['Nguyễn Minh Anh','','']],[[1,1,'A12'],[1,2,'9'],[2,1,'B04'],[2,2,'8']]),
      records('The register is sorted by room. Find the matching badge and complete each row.',badges,['Room','Name','Age','Phone'],[['A12','','',''],['B04','','','']],[[1,1,'Trần Gia Bảo'],[1,2,'9'],[1,3,'000 000 0012'],[2,1,'Nguyễn Minh Anh'],[2,2,'8'],[2,3,'000 000 0021']])];
    case 'Choose data types': return [
      quiz('Use the room booking card to choose a field and its type.','types',types,[['Where does B04 belong?','Room number','Number of chairs','Booked?'],['Which type stores B04?','Text','Number','Date','Yes / No'],['Which field can you add up?','Number of chairs','Room number','Booked?']]),
      quiz('A room code keeps its first zero. Decide how to store the details.','types',[['Field','Example'],['Room number','007'],['Visit date','20 November'],['Places left','0']],[['Which type keeps 007 exactly as written?','Text','Number','Date'],['Which example belongs in Places left?','12','B04','20 November'],['Which field answers “When?”','Visit date','Room number','Places left']])];
    case 'Correct a record': return [
      records('Two rooms were swapped. Repair the register using the badges.',badges,['Name','Room','Phone'],[['Nguyễn Minh Anh','',''],['Trần Gia Bảo','','000 000 0012']],[[1,1,'B04','A12'],[1,2,'000 000 0021','000 000 0012'],[2,1,'A12','B04']]),
      records('Check every editable cell. Keep accurate details. Type Unknown when the badge leaves a detail blank.',[badges[0],'Trần Gia Bảo · Age left blank · Room A12 · Phone 000 000 0012'],['Name','Age','Room','Phone'],[['Trần Gia Bảo','','',''],['Nguyễn Minh Anh','','','']],[[1,1,'Unknown','8'],[1,2,'A12','A21'],[1,3,'000 000 0012','000 000 0021'],[2,1,'8','8'],[2,2,'B04','B40'],[2,3,'000 000 0021','000 000 0021']])];
    case 'Explore file sizes': return [
      quiz(guide,'files',files,[['How large is the poster in KB?','2,000 KB','200 KB','20,000 KB'],['A folder holds 3 MB. After adding the poster, how many KB remain?','1,000 KB','100 KB','5,000 KB']]),
      quiz(guide,'files',files,[['Four copies of the video use how many GB?','3 GB','30 GB','300 GB'],['A 1 GB drive holds one video. How many MB are left?','250 MB','25 MB','750 MB']])];
    case 'File-size ladder': return [
      ladder('Drag the files from smallest to largest. '+guide,['Note · 20 KB','Map · 800 KB','Song · 3 MB','Film · 1 GB']),
      ladder('Convert before comparing. Drag the smallest file to the top. '+guide,['Photo · 1 MB','Poster · 1,200 KB','Movie · 1 GB','Backup · 1,100 MB'])];
    case 'Turn data into information': return [
      quiz('Read the vote chart and compare the clubs.','survey',votes,[['How many more votes did Chess get than Art?','4','2','14'],['Which two clubs have 12 votes together?','Music and Art','Chess and Art','Chess and Music']]),
      quiz('These are the first votes. Three more children now vote for Music. Use the new totals.','survey',votes,[['Which club now leads?','Music','Art','Chess'],['What evidence supports your decision?','Music has 10 votes and Chess has 9.','Chess started with 9 votes.','Music has 7 votes and Art has 5.'],['How many votes have now been counted altogether?','24','21','10']])];
  }
}
