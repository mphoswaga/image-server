(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.FishQuestPlayerPacket=factory();
})(this,()=>{
  const packedPlayers=new WeakMap();
  function pack(players){
    let rows=packedPlayers.get(players);
    if(!rows){
      rows=players.map(p=>[
        p.id,p.name,p.variant,p.x,p.y,p.mass,p.score,p.challengeWins,p.biteAt,
        Number(p.npc)|Number(p.connected)<<1|Number(p.protected)<<2|
        Number(p.respawning)<<3|Number(p.locked)<<4|Number(p.hungry)<<5,
      ]);
      packedPlayers.set(players,rows);
    }
    return rows;
  }
  function unpack(rows){
    return rows.map(([id,name,variant,x,y,mass,score,challengeWins,biteAt,flags])=>({
      id,name,variant,x,y,mass,score,challengeWins,biteAt,
      npc:!!(flags&1),connected:!!(flags&2),protected:!!(flags&4),
      respawning:!!(flags&8),locked:!!(flags&16),hungry:!!(flags&32),
    }));
  }
  return {pack,unpack};
});
