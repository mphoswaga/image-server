// Baselines advance only after the transport accepts a frame. Old clients keep full snapshots.
function prepare(ws,state){
 if(!ws.foodDeltas)return {state,commit:()=>{}};
 const next=new Map(state.food.map(row=>[row[0],row]));
 const previous=ws.foodBaseline;
 const commit=()=>{ws.foodBaseline=next;ws.foodMatchId=state.matchId;};
 if(!previous||ws.foodMatchId!==state.matchId)return {state,commit};
 const upsert=[],remove=[];
 for(const [id,row] of next){const old=previous.get(id);if(!old||old[1]!==row[1]||old[2]!==row[2])upsert.push(row);}
 for(const id of previous.keys())if(!next.has(id))remove.push(id);
 const {food,...rest}=state;
 return {state:{...rest,foodDelta:{upsert,remove}},commit};
}
module.exports={prepare};
