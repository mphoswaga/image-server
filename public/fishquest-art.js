/* Shared FishQuest canvas artwork: used by the live ocean and Smartboard. */
window.FishQuestArt = (()=>{
  const FISH_PALETTES = [
    ['#ffd07a','#f56a38','#b93230','#fff5d8'], ['#a8f8e3','#24bfa9','#167989','#e8fff8'],
    ['#fff2a6','#efb632','#c76724','#fff8d4'], ['#e8c9ff','#9b6ed6','#5d3a96','#f8edff'],
    ['#a7eaff','#359cde','#285da5','#e6f8ff'], ['#ffc3dc','#ec6396','#a92e68','#fff0f6'],
    ['#d7f788','#83c83e','#397c43','#f4ffd8'], ['#ffaaa0','#e64945','#8f2538','#ffe8e2'],
    ['#a4f7ff','#20bdd1','#176f9c','#e8fdff'], ['#bdc4ff','#5969dc','#343783','#eef0ff'],
  ];
  function fishBodyPath(c,stage,species) {
    c.beginPath();
    if(stage==='orca'||stage==='whale') {
      c.moveTo(12,60);c.bezierCurveTo(43,21,128,16,149,42);c.bezierCurveTo(167,78,120,101,58,87);c.quadraticCurveTo(30,77,12,60);c.closePath();return;
    }
    if(stage==='shark') {
      c.moveTo(14,58);c.bezierCurveTo(39,28,102,23,139,40);c.quadraticCurveTo(157,49,151,61);c.quadraticCurveTo(157,72,138,79);c.bezierCurveTo(95,95,39,87,14,58);c.closePath();
      return;
    }
    const hunter=stage==='hunter', minnow=stage==='minnow';
    const shape=species===1
      ? {x:84,y:58,rx:minnow?48:hunter?58:54,ry:minnow?34:hunter?42:45}
      : species===2
        ? {x:82,y:58,rx:minnow?58:hunter?72:68,ry:minnow?25:hunter?31:29}
        : {x:83,y:58,rx:minnow?55:hunter?69:65,ry:minnow?29:hunter?34:38};
    c.ellipse(shape.x,shape.y,shape.rx,shape.ry,0,0,Math.PI*2);
  }
  function fishTexture(scene,variant,part='body',stage='minnow',expression='neutral') {
    const key=`fish-${variant}-${stage}-${part}-${expression}`;
    if(scene.textures.exists(key)) return key;
    const species=Number(variant)%3;
    const [light,base,dark,accent]=stage==='orca'?['#67717e','#202c3c','#101924','#ffffff']:stage==='whale'?['#82b9c8','#46788d','#25495f','#b9dce0']:FISH_PALETTES[Number(variant)%FISH_PALETTES.length];
    const texture=scene.textures.createCanvas(key,160,112),c=texture.context;
    c.lineJoin='round';c.lineCap='round';c.lineWidth=3;c.strokeStyle='#153950';
    const shade=c.createLinearGradient(0,15,0,100);shade.addColorStop(0,light);shade.addColorStop(.5,base);shade.addColorStop(1,dark);c.fillStyle=shade;
    if(part==='tail') {
      if(stage==='shark') {
        c.beginPath();c.moveTo(147,56);c.bezierCurveTo(105,51,76,26,43,9);c.quadraticCurveTo(57,39,48,54);c.quadraticCurveTo(60,69,42,103);c.bezierCurveTo(79,86,111,62,147,56);c.fill();c.stroke();
      } else if(species===1) {
        c.beginPath();c.moveTo(145,56);c.bezierCurveTo(102,48,65,19,31,18);c.quadraticCurveTo(52,46,49,56);c.quadraticCurveTo(52,68,31,94);c.bezierCurveTo(70,92,108,64,145,56);c.fill();c.stroke();
      } else if(species===2) {
        c.beginPath();c.moveTo(145,56);c.bezierCurveTo(100,46,72,28,38,19);c.quadraticCurveTo(53,47,48,56);c.quadraticCurveTo(53,65,38,92);c.bezierCurveTo(76,80,108,65,145,56);c.fill();c.stroke();
      } else {
        c.beginPath();c.moveTo(145,56);c.bezierCurveTo(100,48,68,15,30,12);c.quadraticCurveTo(48,56,30,100);c.bezierCurveTo(70,96,109,63,145,56);c.fill();c.stroke();
      }
      c.strokeStyle=accent;c.globalAlpha=.7;c.lineWidth=2;for(const y of [28,44,68,84]){c.beginPath();c.moveTo(132,56);c.lineTo(49,y);c.stroke();}
    } else if(part==='fin') {
      if(stage==='shark'||stage==='hunter') {
        c.beginPath();c.moveTo(112,31);c.quadraticCurveTo(73,39,37,88);c.quadraticCurveTo(86,82,112,31);c.fill();c.stroke();
      } else if(species===1) {
        c.beginPath();c.moveTo(108,29);c.bezierCurveTo(66,23,37,45,42,91);c.quadraticCurveTo(88,78,108,29);c.fill();c.stroke();
      } else if(species===2) {
        c.beginPath();c.moveTo(111,36);c.quadraticCurveTo(72,43,42,76);c.quadraticCurveTo(85,77,111,36);c.fill();c.stroke();
      } else {
        c.beginPath();c.moveTo(110,30);c.bezierCurveTo(74,25,40,47,35,80);c.quadraticCurveTo(85,87,110,30);c.fill();c.stroke();
      }
      c.strokeStyle=accent;c.lineWidth=2;c.beginPath();c.moveTo(101,38);c.lineTo(49,76);c.stroke();
    } else {
      if(stage==='shark') {
        c.beginPath();c.moveTo(52,35);c.lineTo(76,5);c.lineTo(92,34);c.fill();c.stroke();
      } else if(stage==='hunter'||species===1) {
        c.beginPath();c.moveTo(48,35);c.quadraticCurveTo(67,2,101,19);c.lineTo(116,38);c.fill();c.stroke();
        if(species===1&&stage!=='hunter'){c.beginPath();c.moveTo(51,78);c.quadraticCurveTo(70,111,98,91);c.fill();c.stroke();}
      } else {
        c.beginPath();c.moveTo(52,38);c.quadraticCurveTo(69,12,99,24);c.lineTo(111,40);c.fill();c.stroke();
      }
      fishBodyPath(c,stage,species);c.fill();c.stroke();
      c.save();fishBodyPath(c,stage,species);c.clip();
      if(stage==='orca'||stage==='whale') {
        c.fillStyle=accent;c.beginPath();c.ellipse(95,83,53,14,0,0,Math.PI*2);c.fill();
        if(stage==='orca'){c.beginPath();c.ellipse(114,48,14,7,-.3,0,Math.PI*2);c.fill();}
        else {c.strokeStyle=accent;c.globalAlpha=.5;for(let y=73;y<90;y+=5){c.beginPath();c.moveTo(78,y);c.lineTo(137,y-7);c.stroke();}}
      } else if(species===0) {
        c.fillStyle=accent;c.globalAlpha=stage==='shark'?.45:.78;
        for(const x of [48,76]){c.beginPath();c.moveTo(x,10);c.bezierCurveTo(x-13,42,x+16,72,x+1,106);c.lineTo(x+16,106);c.bezierCurveTo(x+28,71,x+2,39,x+16,10);c.fill();}
      } else if(species===1) {
        c.fillStyle=accent;c.globalAlpha=.72;
        for(const [x,y,r] of [[45,43,7],[66,70,9],[88,38,6],[104,66,7]]){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();}
      } else {
        c.strokeStyle=accent;c.globalAlpha=.82;c.lineWidth=5;
        for(const y of [43,67]){c.beginPath();c.moveTo(20,y);for(let x=20;x<150;x+=16)c.quadraticCurveTo(x+8,y-8,x+16,y);c.stroke();}
      }
      c.globalAlpha=.24;c.fillStyle='#ffffff';c.beginPath();c.ellipse(82,82,55,13,0,0,Math.PI*2);c.fill();c.restore();
      const eyeX=stage==='shark'?128:species===1?118:124,eyeY=stage==='shark'?47:46,eyeSize=stage==='minnow'?17:15;
      c.fillStyle='#ffffff';c.strokeStyle='#153950';c.lineWidth=3;c.beginPath();c.ellipse(eyeX,eyeY,eyeSize,eyeSize+2,-.12,0,Math.PI*2);c.fill();c.stroke();
      c.fillStyle='#113047';c.beginPath();c.ellipse(eyeX+4,eyeY+1,8,11,0,0,Math.PI*2);c.fill();
      c.fillStyle='#ffffff';c.beginPath();c.arc(eyeX+6,eyeY-4,3.5,0,Math.PI*2);c.fill();
      if(expression==='happy'){
        const large=stage==='orca'||stage==='whale';
        const x=large?133:stage==='shark'?134:species===1?123:130;
        const y=large?68:species===2?65:70;
        c.fillStyle='#713943';c.strokeStyle='#422d3a';c.lineWidth=2;
        c.beginPath();c.moveTo(x-9,y-2);c.quadraticCurveTo(x+1,y+1,x+9,y-5);c.quadraticCurveTo(x+5,y+13,x-9,y-2);c.fill();c.stroke();
        c.strokeStyle='#fff8e7';c.lineWidth=2.5;c.beginPath();c.moveTo(x-5,y);c.quadraticCurveTo(x+1,y+1,x+5,y-2);c.stroke();
        c.fillStyle='#fa8592';c.globalAlpha=.5;c.beginPath();c.ellipse(x-15,y-5,5,3,0,0,Math.PI*2);c.fill();c.globalAlpha=1;
      }else{
        c.strokeStyle='#733f44';c.lineWidth=2.5;c.beginPath();c.moveTo(stage==='shark'?121:130,69);c.quadraticCurveTo(140,76,149,65);c.stroke();
      }
      if(stage==='shark') {
        c.strokeStyle='#294e62';c.lineWidth=2;for(const x of [103,109,115]){c.beginPath();c.moveTo(x,53);c.lineTo(x-3,67);c.stroke();}
        c.fillStyle='#ffffff';if(expression!=='happy')for(const x of [130,138,146]){c.beginPath();c.moveTo(x,69);c.lineTo(x+3,75);c.lineTo(x+6,69);c.fill();}
      }
    }
    texture.refresh();return key;
  }

  const canvases=new Map();
  const canvasScene={textures:{
    exists:key=>canvases.has(key),
    createCanvas(key,width,height){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvases.set(key,canvas);return {context:canvas.getContext('2d'),refresh(){}};}
  }};
  const urls=new Map();
  function data(variant,part,stage='reef',expression='neutral'){
    const key=fishTexture(canvasScene,variant,part,stage,expression);
    if(!urls.has(key))urls.set(key,canvases.get(key).toDataURL('image/png'));
    return urls.get(key);
  }
  return {texture:fishTexture,data};
})();
