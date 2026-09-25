(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FishQuestGrowth=factory()})(this,()=>{
const FISH_STAGE_STYLE={
    minnow:{body:.40,tail:.25,fin:.21,tailX:-20,finX:-2,finY:7,label:31},
    reef:{body:.46,tail:.32,fin:.29,tailX:-24,finX:-2,finY:9,label:36},
    hunter:{body:.49,tail:.34,fin:.30,tailX:-26,finX:-1,finY:10,label:39},
    shark:{body:.53,tail:.37,fin:.31,tailX:-29,finX:1,finY:12,label:44},
    orca:{body:.56,tail:.35,fin:.32,tailX:-30,finX:0,finY:12,label:46},
    whale:{body:.60,tail:.38,fin:.34,tailX:-32,finX:0,finY:12,label:48},
  };
  function fishEvolution(mass) {
    const size=Number(mass)||100;
    return size>=800?'whale':size>=650?'orca':size>=450?'shark':size>=280?'hunter':size>=160?'reef':'minnow';
  }
  function fishEvolutionName(stage) {
    return ({minnow:'quick minnow',reef:'reef fish',hunter:'ocean hunter',shark:'shark',orca:'orca',whale:'whale'})[stage]||'fish';
  }
function fishScale(mass){return Math.min(1.85,Math.pow(Math.max(100,Number(mass)||100)/100,.28));}
  const thresholds=[100,160,280,450,650,800];
  function progress(mass){
    const n=Math.max(100,Number(mass)||100),next=thresholds.find(x=>x>n);
    if(!next)return {fraction:1,next:null};
    const previous=thresholds[thresholds.indexOf(next)-1];
    return {fraction:(n-previous)/(next-previous),next};
  }
  return {style:FISH_STAGE_STYLE,evolution:fishEvolution,name:fishEvolutionName,scale:fishScale,progress};
});
