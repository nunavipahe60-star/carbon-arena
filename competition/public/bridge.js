'use strict';
// Load a saved decision record into the preserved viewer without editing its files.
(async()=>{
  const get=id=>document.getElementById(id),uri=new URLSearchParams(location.search).get('replay');
  if(!uri||!(/^(?:\/api\/matches\/[a-f0-9-]{36}\/map-[123]-(first|swapped)|\/api\/(?:season-two|curtain-call)\/matches\/(0|[1-9]\d?)|\/api\/practice\/sessions\/[a-f0-9-]{36}\/matches\/[01])\/replay\.json$/).test(uri))return;
  const controls=['play','step','restart','new-map','seed','depth','red-strategy','blue-strategy','return-live','import'];
  controls.forEach(id=>get(id).disabled=true);
  try{
    const response=await fetch(uri);if(!response.ok)throw Error('Replay is not available');const record=await response.json();
    const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(record)],'match.json',{type:'application/json'}));
    get('replay-file').files=transfer.files;get('replay-file').dispatchEvent(new Event('change',{bubbles:true}));
    const deadline=Date.now()+10000;
    while(window.ARENA.getReplay().strategies?.freezeSHA256!==record.strategies.freezeSHA256){
      if(Date.now()>deadline)throw Error(get('notice').textContent||'Replay import timed out');
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    const title=document.createElement('p');title.className='muted';title.textContent=`${record.strategies.entrants.Red.name} (Red) vs ${record.strategies.entrants.Blue.name} (Blue) · Saved match`;
    document.querySelector('header').after(title);
    let timer=null;const timeline=get('timeline');
    function restore(){
      controls.forEach(id=>get(id).disabled=!['play','step','restart'].includes(id));
      get('play').textContent=timer?'Pause replay':'Play replay';get('restart').textContent='Rewind';get('return-live').hidden=true;
    }
    function stop(){clearInterval(timer);timer=null;restore();}
    function seek(turn){timeline.value=String(turn);timeline.dispatchEvent(new Event('input'));}
    timeline.addEventListener('input',restore);
    get('play').onclick=()=>{if(timer){stop();return;}if(Number(timeline.value)>=record.decisions.length)seek(0);
      timer=setInterval(()=>{const t=Number(timeline.value)+1;if(t>record.decisions.length){stop();return;}seek(t);},Math.max(30,350/Number(get('speed').value)));restore();};
    get('step').onclick=()=>{stop();seek(Math.min(record.decisions.length,Number(timeline.value)+1));};
    get('restart').onclick=()=>{stop();seek(0);};
    timeline.addEventListener('pointerdown',stop);get('return-live').hidden=true;
    for(const a of document.querySelectorAll('a[href*="../playable/"]'))a.hidden=true;
    for(const team of ['red','blue']){const select=get(team+'-strategy');select.replaceChildren(new Option(record.strategies.entrants[team==='red'?'Red':'Blue'].name,'entrant'));}
    const notice=get('notice');notice.hidden=true;seek(0);
  }catch(e){get('notice').textContent=e.message;get('notice').hidden=false;}
})();
