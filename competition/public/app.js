'use strict';
const $=id=>document.getElementById(id);let state,token,refreshing=false,openChallenge=null;
// Consume the private launcher capability before it can remain in browser history.
function consumeOwnerKey(){const key=new URLSearchParams(location.hash.slice(1)).get('owner');if(key)history.replaceState(null,'',location.pathname+location.search);return key;}
let ownerKey=consumeOwnerKey();
const name=id=>state.entries.find(e=>e.id===id)?.name||'Unknown entry';
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function notice(text){$('notice').textContent=text;$('notice').hidden=!text;}
async function post(route,data){const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Arena-Token':token},body:JSON.stringify(data)});
  const value=await r.json();if(!r.ok)throw Error(value.error||'Request failed');return value;}
async function refresh(){if(refreshing)return;refreshing=true;try{const r=await fetch('/api/state');if(!r.ok)throw Error('Could not load the competition archive');state=await r.json();token=state.token;render();}catch(e){notice(e.message);}finally{refreshing=false;}}
function render(){
  $('owner-lock').hidden=!state.owner;
  const open=state.challenges.find(c=>c.id===openChallenge);
  if(open?.sealed&&!state.owner){$('match-dialog').close();$('match-details').replaceChildren();$('replay-frame').src='about:blank';openChallenge=null;}
  const champ=state.entries.find(e=>e.id===state.champion);
  $('champion-name').textContent=champ?champ.name:'The title is open.';
  $('champion-detail').textContent=champ?`${champ.model} · ${champ.version} · Elo ${Math.round(champ.rating)}`:'The first decisive rated challenge crowns our champion.';
  const entries=state.entries.slice().sort((a,b)=>a.practiceOnly-b.practiceOnly||(b.played>0)-(a.played>0)||b.rating-a.rating||a.registeredAt.localeCompare(b.registeredAt));
  $('standings').replaceChildren();let rank=0;
  for(const e of entries){const tr=node('tr'),ranked=!e.practiceOnly&&e.played>0;
    const first=node('td',ranked?String(++rank):'—'),title=node('td');title.append(node('strong',e.name+(e.id===state.champion?' ♛':'')),node('small',e.practiceOnly?'PRACTICE EXAMPLE':e.sha256.slice(0,12)));
    if(e.banned)title.append(node('small','BANNED · no new challenges'));
    const model=node('td',e.model);model.append(node('small',e.version));
    const rating=node('td',e.practiceOnly?'—':String(Math.round(e.rating)),'rating');if(!e.practiceOnly&&e.played<5)rating.append(node('small',e.played===0?'Unrated entry':'Provisional'));
    tr.append(first,title,model,rating,node('td',`${e.wins} / ${e.draws} / ${e.losses}`),node('td',String(e.played)));$('standings').append(tr);
  }
  $('empty').hidden=entries.length>0;
  $('history-count').textContent=`${state.challenges.length} recorded`;
  $('history').replaceChildren();
  if(!state.challenges.length)$('history').append(node('p','Your first challenge will appear here.','muted'));
  for(const c of state.challenges.slice().reverse()){
    const card=node('article',undefined,'history-card'),text=node('div');text.append(node('h3',`${name(c.entries[0])}  vs  ${name(c.entries[1])}`));
    let result=c.status==='passed'?(c.result.score.winner?`${name(c.result.score.winner)} wins`:'Draw'):c.status==='failed'?'Stopped · no rating applied':'In progress';
    if(c.rating)result+=` · ${c.rating.change>=0?'+':''}${c.rating.change.toFixed(1)} / ${(-c.rating.change).toFixed(1)} Elo`;
    text.append(node('p',result,'muted'));card.append(text,node('span',c.rated?'RATED':'PRACTICE','badge'));
    const locked=c.sealed&&!state.owner,b=node('button',locked?'Locked · owner only':c.sealed?'View private challenge →':'View challenge →');b.disabled=locked;b.onclick=()=>details(c);card.append(b);$('history').append(card);
  }
  const running=state.job?.status==='running';$('progress').hidden=!running;
  if(running){$('progress-title').textContent=`${state.job.kind==='season-two'?'Season Two · ':''}Match ${state.job.match} of ${state.job.total||6} · ${state.job.phase}`;
    $('progress-detail').textContent=`Turn ${state.job.turn} of 300 · Each match is also replayed and independently checked.`;
    $('progress-fill').style.width=`${Math.min(99,((state.job.match-1)+state.job.turn/300)/(state.job.total||6)*100)}%`;}
  for(const id of ['enter','challenge','demo'])$(id).disabled=running||state.busy;
  $('challenge').disabled||=entries.filter(e=>!e.banned).length<2;
  if(state.job?.status==='failed')notice((state.job.kind==='season-two'?'Season Two paused: ':'The challenge stopped: ')+state.job.error+'. Evidence is preserved; no ratings were applied.');
}
function details(c){if(c.sealed&&!state.owner)return;openChallenge=c.id;$('match-title').textContent=`${name(c.entries[0])} vs ${name(c.entries[1])}`;$('match-details').replaceChildren();$('replay-frame').hidden=true;$('replay-frame').src='about:blank';
  const p=node('p',c.status==='passed'?(c.result.score.winner?name(c.result.score.winner)+' wins the challenge.':'The challenge is drawn.'):(c.error||'The arena is working on this challenge.'),'muted');$('match-details').append(p);
  if(c.status==='passed'){
    const grid=node('div',undefined,'match-grid');
    for(const pair of c.result.score.pairs){const card=node('article',undefined,'map-card');card.append(node('p','MAP '+(c.seeds.indexOf(pair.seed)+1),'eyebrow'),node('h3',pair.winner?name(pair.winner)+' wins':'Draw'),node('p',`Seed ${pair.seed}`,'muted'));
      for(const eid of c.entries)card.append(node('p',`${name(eid)}: ${pair.cash[eid].toLocaleString()} cash`,'muted'));
      for(const m of c.result.matches.filter(m=>m.seed===pair.seed)){
        const base=`/api/matches/${c.id}/${m.directory}`,button=node('button',`Watch · ${name(m.colors.Red)} as Red`);
        const watchUrl='/viewer/index.html?replay='+encodeURIComponent(base+'/replay.json');
        button.onclick=()=>{$('replay-frame').src=watchUrl;$('replay-frame').hidden=false;$('replay-frame').scrollIntoView({block:'start',behavior:'smooth'});};card.append(button);
        const full=node('a','Open viewer ↗');full.href=watchUrl;full.target='_blank';full.rel='noopener';card.append(full);
        for(const f of ['replay','audit']){const a=node('a',`Save ${f} ↓`);a.href=base+'/'+f+'.json';a.download=`${m.directory}-${f}.json`;card.append(a);}
      }grid.append(card);
    }$('match-details').append(grid);
    const a=node('a','Download verified challenge result ↓');a.href=`/api/challenges/${c.id}/result.json`;a.download=c.id+'-result.json';a.className='muted';$('match-details').append(a);
  }
  $('match-dialog').showModal();
}
$('enter').onclick=()=>{$('register-status').textContent='';$('register-dialog').showModal();};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>{b.closest('dialog').close();if(b.closest('dialog').id==='match-dialog')$('replay-frame').src='about:blank';};
$('register-form').onsubmit=async e=>{e.preventDefault();$('register-submit').disabled=true;$('register-status').textContent='Checking your strategy in both colors…';
  try{const f=new FormData(e.target),file=$('source').files[0];if(!file||file.size>1024*1024)throw Error('Choose a strategy file up to 1 MiB');
    const source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
    await post('/api/register',{name:f.get('name'),model:f.get('model'),version:f.get('version'),notes:f.get('notes'),source});
    e.target.reset();$('register-dialog').close();notice('Strategy checked and registered. Its exact version is now preserved.');await refresh();
  }catch(err){$('register-status').textContent=err.message;}finally{$('register-submit').disabled=false;}};
$('challenge').onclick=()=>{const eligible=state.entries.filter(e=>!e.banned);for(const id of ['entrant-a','entrant-b']){$(id).replaceChildren();for(const e of eligible){const o=node('option',`${e.name} · ${e.version}${e.practiceOnly?' (practice)':''}`);o.value=e.id;$(id).append(o);}}
  if(eligible.some(e=>e.id===state.champion))$('entrant-a').value=state.champion;
  const other=eligible.find(e=>e.id!==$('entrant-a').value);if(other)$('entrant-b').value=other.id;
  $('challenge-status').textContent='';$('challenge-dialog').showModal();};
$('challenge-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('[type=submit]');button.disabled=true;
  try{await post('/api/challenge',{entries:[$('entrant-a').value,$('entrant-b').value],rated:$('challenge-kind').value==='rated'});$('challenge-dialog').close();notice('Entries frozen. The six-match challenge has started.');await refresh();}
  catch(err){$('challenge-status').textContent=err.message;}finally{button.disabled=false;}};
$('demo').onclick=async()=>{try{await post('/api/demo',{});notice('Practice demonstration started. It does not award a title or change Elo.');await refresh();}catch(e){notice(e.message);}};
$('owner-lock').onclick=async()=>{try{await post('/api/owner/lock',{});await refresh();notice('Private records are locked.');}catch(e){notice(e.message);}};
async function unlockOwner(key){try{await post('/api/owner/unlock',{key});await refresh();notice('Owner access is open in this browser for two hours. Lock private records when finished.');}catch(e){notice(e.message);}}
window.addEventListener('hashchange',()=>{const key=consumeOwnerKey();if(key)unlockOwner(key);});
(async()=>{await refresh();if(ownerKey){const key=ownerKey;ownerKey=null;await unlockOwner(key);}})();
setInterval(refresh,2000);
