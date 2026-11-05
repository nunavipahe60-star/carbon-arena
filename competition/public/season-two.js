'use strict';
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
let state=null,submitting=false,renderKey='';
const name=id=>state.entries?.find(e=>e.id===id)?.name||state.catalog.find(e=>e.id===id)?.name||id;
const cash=n=>n.toLocaleString('en-US');
function notice(message){$('notice').textContent=message;$('notice').hidden=!message;}
async function post(route,data){const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Arena-Token':state.token},body:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw Error(value.error||'Operation failed');return value;}
function link(label,url){const a=node('a',label);a.href=url;return a;}
function render(){
  const waiting=state.status==='awaiting-roster',busy=submitting||state.busy||state.job?.status==='running';
  const labels={'awaiting-roster':'Waiting for final versions',frozen:'Roster frozen',ready:'Ready to begin',running:'The season is underway',paused:'Ready to resume',blocked:'Organizer recovery required',completed:'The season is complete'};
  $('season-status').textContent=labels[state.status]||state.status;
  $('season-detail').textContent=waiting?'Finish all three versions before freezing the roster and drawing the official maps.':state.status==='completed'?'All 36 games passed reproducibility and independent checks.':`${state.matches.length} of 36 games verified. The same six maps apply to every pairing.`;
  $('roster-panel').hidden=!waiting;$('frozen-panel').hidden=waiting;
  for(let i=1;i<=3;i++){
    const select=$('entrant-'+i),selected=select.value;
    const key=JSON.stringify(state.catalog.map(e=>[e.id,e.name,e.version]));
    if(select.dataset.catalog!==key){select.replaceChildren(new Option('Choose a final version',''));for(const e of state.catalog)select.append(new Option(`${e.name} · ${e.version} · ${e.model}`,e.id));select.value=selected;select.dataset.catalog=key;}
    select.disabled=busy;
  }
  $('final-confirmation').disabled=busy;$('freeze').disabled=busy||state.catalog.length<3;
  $('run').hidden=!['ready','paused'].includes(state.status);$('run').disabled=busy;
  $('run').textContent=state.status==='paused'?`Resume ${36-state.matches.length} remaining games`:'Start 36 games';
  const job=state.job?.kind==='season-two'&&state.job.status==='running'?state.job:null;
  $('progress').hidden=!job;
  if(job){$('progress-title').textContent=`Game ${job.match} of 36 · ${job.phase}`;$('progress-detail').textContent=`Round ${job.round||1} · Turn ${job.turn} of 300 · Verification follows every game.`;$('progress-fill').style.width=Math.min(99,((job.match-1)+job.turn/300)/36*100)+'%';}
  if(state.error)notice(state.error);else if(state.job?.kind==='season-two'&&state.job.status==='failed')notice(state.job.error);
  const key=JSON.stringify([state.revision,state.entries,state.catalog.map(e=>[e.id,e.name])]);
  if(renderKey===key)return;renderKey=key;
  $('frozen-entries').replaceChildren();
  for(const e of state.entries||[]){const card=node('article',undefined,'map-card');card.append(node('p',e.model,'eyebrow'),node('h3',e.name),node('p',`Version ${e.version}`,'muted'));$('frozen-entries').append(card);}
  $('seed-list').textContent=state.seeds?`Shared maps 1–6: ${state.seeds.join(' · ')}`:'Map reservation is unavailable.';
  $('verified-count').textContent=`${state.matches.length} / 36 verified games`;
  $('table-title').textContent=state.scores?(state.scores.final?'Final standings.':'Provisional standings.'):'Waiting for the final field.';
  $('provisional').hidden=!!state.scores?.final;$('result-download').hidden=state.status!=='completed';
  $('empty').hidden=!!state.scores;$('standings').replaceChildren();
  for(const r of state.scores?.table||[]){const tr=node('tr');for(const text of [r.rank,name(r.id),`${r.points} / 12`,cash(r.cash),`${r.wins} / ${r.draws} / ${r.losses}`,`${r.mapsPlayed} / 12`])tr.append(node('td',String(text)));$('standings').append(tr);}
  const opened=new Set([...document.querySelectorAll('#pairings details[open]')].map(e=>e.dataset.pair));$('pairings').replaceChildren();
  for(const p of state.scores?.pairings||[]){
    const card=node('details',undefined,'pairing-card'),pair=p.entries,key=pair.join(':');card.dataset.pair=key;card.open=opened.has(key);
    const summary=node('summary'),title=node('strong',`${name(pair[0])} vs ${name(pair[1])}`);summary.append(title,node('p',pair.map(id=>`${name(id)}: ${p.points[id]} / 6 points · ${cash(p.totalCash[id])} cash`).join(' | '),'muted'),node('span',p.complete?(p.winner?`${name(p.winner)} wins the pairing`:'Exact tie'):`Provisional · ${p.matchesVerified} / 12 games verified`,'badge'));card.append(summary);
    const grid=node('div',undefined,'match-grid');
    for(let i=0;i<6;i++){
      const score=p.maps.find(m=>m.seed===state.seeds[i]),mcard=node('article',undefined,'map-card');
      mcard.append(node('p',`ROUND ${Math.floor(i/3)+1} · MAP ${i+1}`,'eyebrow'),node('h3',score?(score.winner?`${name(score.winner)} wins`:'Draw'):'Awaiting both games'),node('p',`Seed ${state.seeds[i]}`,'muted'));
      if(score)for(const id of pair)mcard.append(node('p',`${name(id)}: ${cash(score.cash[id])} cash`,'muted'));
      for(const m of state.matches.filter(m=>m.pair[0]===pair[0]&&m.pair[1]===pair[1]&&m.map===i+1)){
        const base=`/api/season-two/matches/${m.index}`,watch=link(`Watch · ${name(m.colors.Red)} as Red ↗`,'/viewer/index.html?replay='+encodeURIComponent(base+'/replay.json'));watch.target='_blank';watch.rel='noopener';mcard.append(watch);
        for(const f of ['replay','audit']){const a=link(`Save ${f} ↓`,base+'/'+f+'.json');a.download=`season-two-game-${m.index+1}-${f}.json`;mcard.append(a);}
      }grid.append(mcard);
    }card.append(grid);$('pairings').append(card);
  }
}
async function refresh(){try{const r=await fetch('/api/season-two');if(!r.ok)throw Error('Could not load Season Two');state=await r.json();render();}catch(e){notice(e.message);}}
$('roster-form').onsubmit=async e=>{e.preventDefault();if(submitting)return;submitting=true;render();try{await post('/api/season-two/freeze',{entries:[1,2,3].map(i=>$('entrant-'+i).value),confirmedFinalVersions:$('final-confirmation').checked});notice('Final roster frozen. Six shared maps reserved. Start the season when ready.');}catch(err){notice(err.message);}finally{submitting=false;await refresh();}};
$('run').onclick=async()=>{if(submitting)return;submitting=true;render();try{await post('/api/season-two/run',{});notice('Season started. Each game is reproduced and independently verified.');}catch(err){notice(err.message);}finally{submitting=false;await refresh();}};
refresh();setInterval(refresh,2000);
