// Narrative consequences derive from saved votes, never from assessment marks.
const chapters = [
  {title:'The broken moon bridge',obstacle:'The rabbits reach a river. The old bridge is broken. How can your crew cross?',options:[
    {id:'bridge',title:'Build a lantern bridge',result:'Your sparks mend the bridge. The rabbits hop across, leaving a safe path home.'},
    {id:'stars',title:'Follow the guiding stars',result:'Your sparks become stepping stars. The rabbits leap along a new path above the water.'}]},
  {title:'The mist in the moon garden',obstacle:'Moon mist hides the courtyard. Choose how your crew will find the school.',options:[
    {id:'kite',title:'Fly a wind kite',result:'Your kite catches the breeze and sweeps the mist away. It stays above the garden to guide you home.'},
    {id:'tower',title:'Build a lantern tower',result:'Your tower shines through the mist. The rabbits follow its golden beam to Vinschool.'}]},
  {title:'Bring the festival home',obstacle:'Your crew has brought its sparks home. How will your rabbits celebrate?',options:[
    {id:'mooncakes',title:'Share a mooncake feast',result:'The rabbits carry mooncakes along your route and set a feast beneath the lanterns.'},
    {id:'drums',title:'Lead a lantern parade',result:'Your rabbits march along the path you made, carrying lanterns home to the beat of festival drums.'}]}
];
function worlds(s){
  const teams=s.duels?[0,1]:[null];
  return teams.map(team=>{
    const decisions=(s.story?.history||[]).flatMap(c=>{
      const result=team===null?c:c.teamResults?.find(t=>t.team===team)||c;
      const choice=c.options?.[result.winner];
      return choice?[{id:choice.id,title:choice.title,result:choice.result,checkpoint:c.id,tied:!!result.tied,noVotes:!!result.noVotes}]:[];
    });
    return {team,decisions,route:decisions.find(d=>['bridge','stars'].includes(d.id))?.id||null,
      beacon:decisions.find(d=>['kite','tower'].includes(d.id))?.id||null,
      celebration:decisions.find(d=>['mooncakes','drums','garden'].includes(d.id))?.id||null};
  });
}
function snapshot(s){return {version:s.story?.version||1,worlds:worlds(s),complete:!!s.story?.complete};}
module.exports={chapters,worlds,snapshot};
