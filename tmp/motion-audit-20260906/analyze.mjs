import fs from 'node:fs';
const rows=fs.readFileSync(new URL('./fleet.jsonl',import.meta.url),'utf8').trim().split('\n').map(JSON.parse);
const prev=new Map(), transitions=[], counts=new Map();
for(const row of rows)for(const p of row.projects)for(const a of p.agents){const key=p.projectRoot+'::'+a.id;const old=prev.get(key);if(old&&old.seat!==a.seat){const t={at:row.at,project:p.projectLabel,id:a.id,label:a.label,seat:a.seat,from:{state:old.state,status:old.statusText,current:old.isCurrent,ongoing:old.isOngoing,stop:old.stoppedAt,updated:old.updatedAt},to:{state:a.state,status:a.statusText,current:a.isCurrent,ongoing:a.isOngoing,stop:a.stoppedAt,updated:a.updatedAt},message:a.latestMessage};transitions.push(t);counts.set(key,(counts.get(key)||0)+1);}prev.set(key,a);}
const out={samples:rows.length,from:rows[0].at,to:rows.at(-1).at,transitions,counts:[...counts].map(([key,n])=>({key,n})).sort((a,b)=>b.n-a.n)};
fs.writeFileSync(new URL('./analysis.json',import.meta.url),JSON.stringify(out,null,2));
console.log(JSON.stringify({...out,transitions:transitions.slice(0,18)},null,2));
