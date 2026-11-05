'use strict';
const $=id=>document.getElementById(id);
let state,token,refreshing=false,submitting=false,registering=false,selected=null,catalogKey='',historyKey='',detailKey='';
const statuses={prepared:'Preparing',running:'Running',completed:'Completed',failed:'Stopped',interrupted:'Interrupted'};
const number=n=>n.toLocaleString('en-US');
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function notice(text){$('notice').textContent=text;$('notice').hidden=!text;}
async function post(route,input){const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Arena-Token':token},body:JSON.stringify(input)});const value=await r.json();if(!r.ok)throw Error(value.error||'The operation could not be completed');return value;}
async function refresh(){if(refreshing)return;refreshing=true;try{const r=await fetch('/api/practice');if(!r.ok)throw Error('Practice records are unavailable. Please refresh and try again.');state=await r.json();token=state.token;render();}catch(e){notice(e.message);}finally{refreshing=false;}}
function availability(){const busy=!state||state.busy||state.job?.status==='running'||submitting||registering;
 $('run').disabled=busy||!$('entrant-a').value||!$('entrant-b').value||$('entrant-a').value===$('entrant-b').value;
 $('register-open').disabled=busy;$('register-submit').disabled=busy;
 for(const id of ['entrant-a','entrant-b','seed'])$(id).disabled=busy;
 $('availability').textContent=registering?'Checking the new strategy…':state?.job?.status==='running'?'The arena is busy. Wait for the current task to finish.':submitting?'Preparing both games…':state?.busy?'The arena is processing a request. Please wait.':$('entrant-a').value&&$('entrant-a').value===$('entrant-b').value?'Choose two different strategies.':'Play one game in each color on the same map. Results and replays are saved automatically.';
}
function render(){
 const nextCatalog=JSON.stringify(state.catalog.map(e=>[e.id,e.name,e.version]));
 if(catalogKey!==nextCatalog){catalogKey=nextCatalog;for(const id of ['entrant-a','entrant-b']){const choice=$(id).value;$(id).replaceChildren(new Option('Choose a strategy',''));for(const e of state.catalog)$(id).append(new Option(`${e.name} · ${e.version}`,e.id));$(id).value=choice;}}
 if(!selected&&state.sessions.length)selected=state.sessions[0].id;
 availability();const job=state.job,running=job?.status==='running';$('progress').hidden=!running;
 if(running){const quick=job.kind==='quick-practice',phase=job.phase==='Independent verification'?'Verifying this game':job.phase==='Playing'?'Playing':'Preparing';
  $('progress-title').textContent=quick?`Game ${job.match} / 2 · ${phase}`:'The arena is running another task';
  $('progress-detail').textContent=`Turn ${job.turn} / 300${quick?' · '+(job.match===1?'A is Red, B is Blue':'B is Red, A is Blue'):''}`;
  const percent=Math.min(99,Math.round(((job.match-1)+job.turn/300)/(job.total||2)*100));$('progress-fill').style.width=percent+'%';$('progress-meter').setAttribute('aria-valuenow',String(percent));
 }
 const nextHistory=JSON.stringify([selected,state.sessions]);if(historyKey!==nextHistory){historyKey=nextHistory;$('history-count').textContent=`${state.sessions.length} sessions`;$('history').replaceChildren();
  if(!state.sessions.length)$('history').append(el('p','No practice sessions yet. Choose two strategies to begin.','muted'));
  for(const s of state.sessions){const card=el('article',undefined,'history-card'+(s.id===selected?' selected':'')),text=el('div');text.append(el('h3',s.entries.map(e=>e.name).join(' vs ')));
   const result=s.result?` · ${s.result.winner?s.entries.find(e=>e.id===s.result.winner).name+' wins by '+number(s.result.difference):'Combined cash is tied'}`:'';
   text.append(el('p',`Seed ${s.seed} · ${new Date(s.createdAt).toLocaleString('en-US')}${result}`,'muted'));const button=el('button','View session →');button.onclick=()=>{selected=s.id;detailKey='';$('replay-frame').hidden=true;$('replay-frame').src='about:blank';render();$('session-section').scrollIntoView({behavior:'smooth',block:'start'});};card.append(text,el('span',statuses[s.status]||s.status,'badge'),button);$('history').append(card);}
 }
 renderDetail();
}
function renderDetail(){const s=state.sessions.find(s=>s.id===selected);$('session-section').hidden=!s;if(!s)return;
 const key=JSON.stringify(s);if(detailKey===key)return;detailKey=key;$('session-title').textContent=s.entries.map(e=>e.name).join(' vs ');$('session-status').textContent=statuses[s.status]||s.status;
 const root=$('session-detail');root.replaceChildren();const name=id=>s.entries.find(e=>e.id===id)?.name||'Unknown strategy';
 const text=s.result?(s.result.winner?`${name(s.result.winner)} wins by ${number(s.result.difference)} cash`:'Combined cash is tied'):s.status==='running'?'Playing both colors on the same map…':s.error?'This session did not finish. Existing records have been retained.':'Preparing the map…';
 root.append(el('p',text,'result-lead'),el('p',`Map seed ${s.seed} · ${s.matches.length} / 2 games completed · 300 turns per game`,'muted'));
 if(s.error)root.append(el('p',s.error,'session-error'));
 if(s.result){const wrap=el('div',undefined,'table-wrap'),table=el('table'),head=el('thead'),tr=el('tr');for(const title of ['Strategy','First game','Swapped game','Total cash'])tr.append(el('th',title));head.append(tr);table.append(head);const body=el('tbody');for(const row of s.result.rows){const r=el('tr');r.append(el('td',name(row.id)),el('td',number(row.first)),el('td',number(row.swapped)),el('td',number(row.total),'total'));body.append(r);}table.append(body);wrap.append(table);root.append(wrap);}
 const grid=el('div',undefined,'replay-grid');
 for(const m of s.matches){const card=el('article',undefined,'map-card'),base=`/api/practice/sessions/${s.id}/matches/${m.index}`,url='/viewer/index.html?replay='+encodeURIComponent(base+'/replay.json');
  card.append(el('p',m.index===0?'GAME 01 · FIRST':'GAME 02 · SWAPPED','eyebrow'),el('h3',m.index===0?'First game':'Swapped game'),el('p',`Red: ${name(m.colors.Red)} · ${number(m.cash.Red)} cash`),el('p',`Blue: ${name(m.colors.Blue)} · ${number(m.cash.Blue)} cash`));
  if(m.failures)card.append(el('p',`${m.failures} strategy calls failed and became WAIT turns under the rules.`,'muted'));
  const watch=el('button','Watch replay here →');watch.type='button';watch.onclick=()=>{$('replay-frame').src=url;$('replay-frame').hidden=false;$('replay-frame').scrollIntoView({behavior:'smooth',block:'start'});};
  const open=el('a','Open in a new tab ↗');open.href=url;open.target='_blank';open.rel='noopener';const download=el('a','Download replay ↓');download.href=base+'/replay.json';download.download=`practice-${s.seed}-${m.index+1}.json`;card.append(watch,open,download);grid.append(card);
 }root.append(grid);
 if(s.result){const download=el('a','Download session results ↓');download.href=`/api/practice/sessions/${s.id}/result.json`;download.download=`practice-${s.seed}-result.json`;root.append(download);}
}
for(const id of ['entrant-a','entrant-b'])$(id).onchange=availability;
$('practice-form').onsubmit=async e=>{e.preventDefault();if($('run').disabled)return;submitting=true;availability();notice('');try{const input={entries:[$('entrant-a').value,$('entrant-b').value]};if($('seed').value!=='')input.seed=Number($('seed').value);const r=await post('/api/practice/run',input);selected=r.id;detailKey='';$('replay-frame').hidden=true;$('replay-frame').src='about:blank';notice('Both games have started. Results will appear below when they finish.');await refresh();}catch(error){notice(error.message);}finally{submitting=false;availability();}};
$('register-open').onclick=()=>{$('register-status').textContent='';$('register-dialog').showModal();};
$('register-close').onclick=()=>{if(!registering)$('register-dialog').close();};
$('register-dialog').addEventListener('cancel',e=>{if(registering)e.preventDefault();});
$('register-form').onsubmit=async e=>{e.preventDefault();if(registering)return;registering=true;availability();$('register-status').textContent='Checking the strategy in both colors…';try{
 const file=$('source').files[0];if(!file||file.size>1024*1024)throw Error('Choose a strategy file no larger than 1 MiB.');const bytes=new Uint8Array(await file.arrayBuffer()),source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),roundtrip=new TextEncoder().encode(source);
 if(bytes.length!==roundtrip.length||bytes.some((b,i)=>b!==roundtrip[i]))throw Error('The file could not be read without changes. Use UTF-8 encoding.');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const registered=state.catalog.find(e=>e.sha256===digest);if(registered){$('entrant-a').value=registered.id;$('register-dialog').close();notice(`This strategy is already registered as "${registered.name}" and is now selected as strategy A.`);return;}
 const f=new FormData(e.target),result=await post('/api/register',{name:f.get('name'),model:f.get('model'),version:f.get('version'),notes:'Registered from the quick practice room; registration alone has no rating effect.',source});
 if(result.entry.sha256!==digest)throw Error('The registered file hash differs. Check the saved archive.');await refresh();$('entrant-a').value=result.entry.id;e.target.reset();$('register-dialog').close();notice(`"${result.entry.name}" is registered and selected as strategy A. Choose an opponent to begin.`);
 }catch(error){$('register-status').textContent=error.message;}finally{registering=false;availability();}};
refresh();setInterval(refresh,1500);
