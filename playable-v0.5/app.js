(function(){
  'use strict';
  const E=CarbonArena,S=CarbonStrategies,$=id=>document.getElementById(id),canvas=$('board'),ctx=canvas.getContext('2d');
  const colors={Red:'#ff827c',Blue:'#80adff'}, P=52,C=60, END=P+15*C;
  let state,record,playing=false,timer=null,selected=null,viewing=false,viewState=null,reasons={},lastPositions=new Map(),movedAt=0,raf=0;
  function seedValue(){const n=Number($('seed').value);if(!Number.isInteger(n)||n<0||n>4294967295)throw Error('Choose a whole-number seed between 0 and 4,294,967,295.');return n;}
  function notice(message){$('notice').textContent=message;$('notice').hidden=false;}
  function pause(){playing=false;clearTimeout(timer);$('play').textContent=state?.ended?'Match complete':'Resume';}
  function initialize(seed=seedValue()){
    pause();state=E.create(seed);viewState=null;viewing=false;selected=null;reasons={};lastPositions.clear();
    record={format:'carbon-arena-replay-v1',rulesVersion:E.VERSION,generator:E.GENERATOR,coordinateSystem:'zero-based-xy',seed,settings:{...state.settings},
      strategies:{Red:$('red-strategy').value,Blue:$('blue-strategy').value,version:S.VERSION,depth:Number($('depth').value),candidateBudget:S.BUDGET},decisions:[]};
    $('seed').value=seed;$('notice').hidden=true;$('return-live').hidden=true;$('play').textContent='Start match';render();
  }
  function runTurn(){
    if(state.ended||viewing)return;
    if(state.turn===0)record.strategies={Red:$('red-strategy').value,Blue:$('blue-strategy').value,version:S.VERSION,depth:Number($('depth').value),candidateBudget:S.BUDGET};
    lastPositions=new Map(state.vehicles.map(v=>[E.key(v),{x:v.x,y:v.y}]));
    const snap=E.snapshot(state),decisions={};reasons={};
    for(const team of E.TEAMS){
      try{const r=S.decide(snap,team,$(team.toLowerCase()+'-strategy').value,Number($('depth').value));decisions[team]=r.decision;reasons[team]=r.reasons;}
      catch(error){pause();notice(team+' strategy failed: '+error.message);decisions[team]={failure:error.message||'Strategy exception',vehicles:[],purchases:[]};}
    }
    const result=E.resolve(state,decisions);record.decisions.push(result.decisions);movedAt=performance.now();
    if(state.ended)pause();render();animate();
  }
  function schedule(){clearTimeout(timer);if(!playing)return;timer=setTimeout(()=>{runTurn();if(playing&&!state.ended)schedule();},1000/Number($('speed').value));}
  function togglePlay(){if(viewing||state.ended)return;if(playing)pause();else{playing=true;$('play').textContent='Pause';schedule();}render();}
  function shown(){return viewing?viewState:state;}
  function draw(){
    const s=shown();if(!s)return;
    ctx.clearRect(0,0,1000,1000);ctx.fillStyle='#101914';ctx.fillRect(0,0,1000,1000);
    ctx.font='17px Segoe UI';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#728d78';
    for(let n=0;n<15;n++){ctx.fillText(n+1,P+n*C+C/2,28);ctx.fillText(n+1,27,P+n*C+C/2);}
    for(let y=0;y<15;y++)for(let x=0;x<15;x++){
      const n=s.ground[E.index(x,y)],t=Math.min(1,n/100),a=P+x*C,b=P+y*C;
      ctx.fillStyle=`rgb(${Math.round(20+t*70)},${Math.round(36+t*83)},${Math.round(25+t*38)})`;ctx.fillRect(a+1,b+1,C-2,C-2);
      if(n>100){ctx.fillStyle='#b4d681';ctx.fillRect(a+4,b+4,7,3);}
    }
    for(const team of E.TEAMS)for(const [x,y] of E.HQ[team]){
      const a=P+x*C+C/2,b=P+y*C+C/2;ctx.fillStyle=colors[team];ctx.globalAlpha=.14;ctx.fillRect(a-C/2+2,b-C/2+2,C-4,C-4);ctx.globalAlpha=1;
      ctx.strokeStyle=colors[team];ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(a-15,b-1);ctx.lineTo(a,b-15);ctx.lineTo(a+15,b-1);ctx.moveTo(a-11,b-4);ctx.lineTo(a-11,b+13);ctx.lineTo(a+11,b+13);ctx.lineTo(a+11,b-4);ctx.moveTo(a-4,b+13);ctx.lineTo(a-4,b+3);ctx.lineTo(a+4,b+3);ctx.lineTo(a+4,b+13);ctx.stroke();
    }
    for(const t of s.trees){const a=P+t.x*C+C/2,b=P+t.y*C+C/2;ctx.fillStyle='#9ec66c';ctx.fillRect(a-2,b+1,4,17);ctx.beginPath();ctx.moveTo(a,b-20);ctx.lineTo(a-15,b+6);ctx.lineTo(a+15,b+6);ctx.closePath();ctx.fill();ctx.strokeStyle=colors[t.team];ctx.lineWidth=3;ctx.beginPath();ctx.arc(a,b+20,14,0,2*Math.PI*t.remaining/50);ctx.stroke();}
    const progress=viewing?1:Math.min(1,(performance.now()-movedAt)/Math.min(190,900/Number($('speed').value)));
    const buckets=new Map();for(const v of s.vehicles){const k=v.x+','+v.y;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(v);}
    for(const v of s.vehicles){
      if(E.isHQ(v.x,v.y,v.team))continue;
      const old=lastPositions.get(E.key(v)),stack=buckets.get(v.x+','+v.y),slot=stack.indexOf(v);
      let x=v.x,y=v.y;
      if(old&&progress<1){const dx=v.x-old.x,dy=v.y-old.y;if(Math.abs(dx)<=1&&Math.abs(dy)<=1){x=old.x+dx*progress;y=old.y+dy*progress;}}
      const a=P+x*C+C/2+(stack.length>1?(slot%3-1)*12:0),b=P+y*C+C/2+(stack.length>1?(Math.floor(slot/3)-Math.floor(stack.length/6))*12:0);
      ctx.fillStyle=colors[v.team];ctx.strokeStyle='#101914';ctx.lineWidth=2.8;ctx.beginPath();
      if(v.type==='collector')ctx.arc(a,b,stack.length>3?8:11,0,Math.PI*2);else{ctx.moveTo(a,b-13);ctx.lineTo(a-12,b+10);ctx.lineTo(a+12,b+10);ctx.closePath();}ctx.fill();ctx.stroke();
      if($('labels').checked&&v.cargo){ctx.font='bold 14px Segoe UI';ctx.lineWidth=4;ctx.strokeText(v.cargo,a,b-19);ctx.fillStyle='#f2f6e9';ctx.fillText(v.cargo,a,b-19);}
    }
    for(const team of E.TEAMS)for(const [x,y] of E.HQ[team]){
      const count=buckets.get(x+','+y)?.length||0;if(!count)continue;
      const a=P+x*C+47,b=P+y*C+13;ctx.fillStyle=colors[team];ctx.beginPath();ctx.arc(a,b,11,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#101914';ctx.font='bold 14px Segoe UI';ctx.fillText(count,a,b);
    }
    if(selected){const a=P+selected.x*C,b=P+selected.y*C;ctx.strokeStyle='#ecf5c5';ctx.lineWidth=3;ctx.strokeRect(a+2,b+2,C-4,C-4);}
    ctx.strokeStyle='#364e3b';ctx.lineWidth=1;ctx.strokeRect(P,P,END-P,END-P);
  }
  function animate(){cancelAnimationFrame(raf);const start=performance.now();function frame(){draw();if(performance.now()-start<220&&!viewing)raf=requestAnimationFrame(frame);}raf=requestAnimationFrame(frame);}
  function inspect(){
    const s=shown();if(!selected){$('cell-title').textContent='Explore the arena';$('cell-info').innerHTML='<p class="muted">Select any cell to see its carbon, vehicles, and trees.</p>';return;}
    $('cell-title').textContent='Cell '+(selected.x+1)+', '+(selected.y+1);
    const parts=[`<div class="cell-row"><span>Ground carbon</span><strong>${s.ground[E.index(selected.x,selected.y)]}</strong></div>`];
    for(const team of E.TEAMS)if(E.isHQ(selected.x,selected.y,team))parts.push(`<div class="cell-row"><span>${team} headquarters</span><strong class="${team.toLowerCase()}-text">Safe home</strong></div>`);
    for(const t of s.trees.filter(t=>E.same(t,selected)))parts.push(`<div class="unit-info"><strong class="${t.team.toLowerCase()}-text">${t.team} tree #${t.id}</strong><p>Storage: ${t.storage} · Life: ${t.remaining} working turns<br>Generation: ${s.settings.treeGeneration} carbon per working turn</p></div>`);
    for(const v of s.vehicles.filter(v=>E.same(v,selected))){const info=viewing?null:reasons[v.team]?.[v.id];parts.push(`<div class="unit-info"><strong class="${v.team.toLowerCase()}-text">${v.team} ${v.type} #${v.id}</strong><p>Cargo: ${v.cargo}${info?'<br>Last decision: '+info.action.replaceAll('_',' ').toLowerCase()+' · '+info.role:''}${info?.target?'<br>Target: '+info.target.map(n=>n+1).join(', '):''}</p></div>`);}
    $('cell-info').innerHTML=parts.join('');
  }
  function eventText(e){const who=e.team?`<span class="${e.team.toLowerCase()}-text">${e.team}</span>`:'';
    if(e.type==='sale')return who+' sold '+e.amount+' carbon';
    if(e.type==='theft')return who+' stole '+e.amount+' carbon';
    if(e.type==='destroy')return who+' '+e.vehicle+' lost · '+({empty_tie:'empty cargo tie',cargo_tie:'loaded cargo tie',theft:'cargo stolen'}[e.cause]||'collision');
    if(e.type==='plant')return who+' planted tree '+e.tree;
    if(e.type==='tree_generation')return who+' tree '+e.tree+' generated '+e.amount+' carbon';
    if(e.type==='expiry')return who+' tree expired · '+e.amount+' released';
    if(e.type==='pickup')return who+' picked up '+e.amount+' from tree '+e.tree;
    if(e.type==='purchase')return who+' bought a '+e.vehicleType;
    if(e.type==='strategy_failure')return who+' strategy failed; match paused';
    return '';
  }
  function render(){
    const s=shown();$('turn').textContent=s.turn;$('progress').style.width=(s.turn/s.settings.turns*100)+'%';
    $('winner').textContent=s.ended?(s.winner==='Draw'?'The match ends in a draw.':s.winner+' wins the arena.'):'Bring carbon home. Keep the fleet moving.';
    $('status').textContent=viewing?'Replay · Turn '+s.turn:s.ended?'Match complete':playing?'Match running':s.turn?'Match paused':'Ready to compete';
    for(const team of E.TEAMS){const vs=s.vehicles.filter(v=>v.team===team);$(team.toLowerCase()+'-cash').textContent=s.teams[team].cash.toLocaleString('en-US');$(team.toLowerCase()+'-stats').innerHTML=`<span><strong>${vs.length}/${s.settings.fleetLimit}</strong> vehicles</span><span><strong>${s.trees.filter(t=>t.team===team).length}/${s.settings.treeLimit}</strong> trees</span><span><strong>${vs.reduce((a,v)=>a+v.cargo,0)}</strong> cargo</span>`;}
    const m=s.history.at(-1);
    $('metrics').innerHTML=[['On the ground',m.ground],['Stored in trees',m.stored],['In transit',m.inTransit],['Carbon sold',m.sold],['Ground regenerated',m.regenerated],['Tree generated',m.treeGenerated],['Red tree generated',m.treeGeneratedByTeam.Red],['Blue tree generated',m.treeGeneratedByTeam.Blue],['Conservation error',m.carbonError],['Expiry releases',m.expiryReleased],['Vehicles lost',s.teams.Red.losses+s.teams.Blue.losses],['Lost in empty ties',m.losses.empty_tie],['Lost in loaded ties',m.losses.cargo_tie],['Lost to theft',m.losses.theft]].map(([name,n])=>`<div class="cell-row"><span>${name}</span><strong>${n.toLocaleString('en-US')}</strong></div>`).join('');
    const peak=Math.max(1,...s.history.map(h=>h.ground)),points=s.history.map(h=>`${4+272*h.turn/Math.max(1,s.turn)},${48-44*h.ground/peak}`).join(' ');
    $('ground-history').innerHTML=`<div class="cell-row"><span>Ground carbon over time</span><strong>0–${s.turn}</strong></div><svg viewBox="0 0 280 52" role="img" aria-label="Ground carbon: ${s.history[0].ground} at turn zero, ${m.ground} at turn ${s.turn}"><polyline points="${points}" fill="none" stroke="#b5d67c" stroke-width="2"/></svg>`;
    const events=s.events.filter(e=>eventText(e));$('event-count').textContent=events.length+' events';
    $('events').innerHTML=events.slice(-14).reverse().map(e=>`<div class="event"><time>${e.turn}</time>${eventText(e)}</div>`).join('')||'<p class="muted">The match begins when you press Start.</p>';
    $('timeline').max=record.decisions.length;$('timeline').value=s.turn;$('timeline-value').textContent=s.turn;
    $('play').disabled=viewing||s.ended;$('step').disabled=viewing||s.ended;
    for(const id of ['red-strategy','blue-strategy','depth'])$(id).disabled=state.turn>0||viewing;
    $('return-live').hidden=!viewing;inspect();draw();
  }
  $('play').onclick=togglePlay;$('step').onclick=()=>{pause();runTurn();};$('restart').onclick=()=>{try{initialize();}catch(e){notice(e.message);}};
  $('new-map').onclick=()=>initialize(crypto.getRandomValues(new Uint32Array(1))[0]);$('speed').onchange=()=>{if(playing)schedule();};$('labels').onchange=draw;
  $('timeline').oninput=()=>{pause();try{viewState=E.replay(record,Number($('timeline').value));viewing=true;render();}catch(e){notice(e.message);}};
  $('return-live').onclick=()=>{viewing=false;viewState=null;render();};
  function downloadJSON(value,name){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('export').onclick=()=>downloadJSON(record,'carbon-arena-seed-'+record.seed+'-turn-'+record.decisions.length+'.json');
  $('export-audit').onclick=()=>{const s=shown();downloadJSON({...E.audit(s),strategies:record.strategies},'carbon-arena-audit-seed-'+s.seed+'-turn-'+s.turn+'.json');};
  $('import').onclick=()=>{pause();$('replay-file').click();};
  $('replay-file').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>5*1024*1024)throw Error('Replay is too large.');const candidate=JSON.parse(await file.text()),loaded=E.replay(candidate);record=candidate;state=loaded;viewState=loaded;viewing=true;reasons={};selected=null;$('seed').value=record.seed;for(const team of E.TEAMS){const preset=record.strategies?.[team];if(S.PRESETS[preset])$(team.toLowerCase()+'-strategy').value=preset;}if([4,5].includes(record.strategies?.depth))$('depth').value=record.strategies.depth;$('notice').hidden=true;render();}catch(e){notice('Could not open replay: '+e.message);}event.target.value='';};
  $('help').onclick=()=>$('rules-dialog').showModal();$('close-help').onclick=()=>$('rules-dialog').close();
  canvas.onclick=e=>{const rect=canvas.getBoundingClientRect(),x=Math.floor(((e.clientX-rect.left)*1000/rect.width-P)/C),y=Math.floor(((e.clientY-rect.top)*1000/rect.height-P)/C);if(x>=0&&x<15&&y>=0&&y<15){selected={x,y};inspect();draw();}};
  canvas.onkeydown=e=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();selected=selected||{x:7,y:7};if(e.key==='ArrowUp')selected.y=E.mod(selected.y-1);if(e.key==='ArrowDown')selected.y=E.mod(selected.y+1);if(e.key==='ArrowLeft')selected.x=E.mod(selected.x-1);if(e.key==='ArrowRight')selected.x=E.mod(selected.x+1);inspect();draw();};
  // A small read-only interface for local verification and inspection.
  window.ARENA={getState:()=>E.clone(shown()),getReplay:()=>E.clone(record),step:()=>{pause();runTurn();}};
  initialize();
})();
