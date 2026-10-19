/** Import an explicitly supplied private timetable without changing any other workspace data. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createStore} from '../backend/store.mjs';
import {isCliEntry} from '../backend/is-cli.mjs';
import {mergeTimetables,validateTimetable} from '../frontend/src/timetable-model.js';

export function importTimetable(store,input,{dryRun=false}={}) {
  const incoming=validateTimetable(input);
  for(let attempt=0;attempt<3;attempt++){
    const current=store.getWorkspace();
    if(!current.state)throw new Error('An initialized private workspace is required.');
    const {timetable:previous,...unrelated}=current.state;
    const merged=mergeTimetables(previous,incoming);
    const next={...current.state,timetable:merged.timetable};
    const {timetable:ignored,...after}=next;
    if(JSON.stringify(unrelated)!==JSON.stringify(after))throw new Error('Unrelated workspace data changed.');
    const changed=JSON.stringify(previous)!==JSON.stringify(merged.timetable);
    const report={ok:true,dryRun,changed,added:merged.count,terms:merged.timetable.terms.length,entries:merged.timetable.terms.reduce((n,t)=>n+t.entries.length,0),revision:current.revision,otherDataPreserved:true};
    if(dryRun||!changed)return report;
    try {const saved=store.saveWorkspace(current.revision,next);return {...report,revision:saved.revision};}
    catch(error){if(error.code!=='revision_conflict'||attempt===2)throw error;}
  }
}

if(isCliEntry(import.meta.url)){
  const args=process.argv.slice(2),dataIndex=args.indexOf('--data-dir'),fileIndex=args.indexOf('--file');
  if(dataIndex<0||fileIndex<0||!args[dataIndex+1]||!args[fileIndex+1])throw new Error('Usage: --data-dir <private-data-dir> --file <private-timetable.json> [--dry-run]');
  const input=JSON.parse(readFileSync(resolve(args[fileIndex+1]),'utf8'));
  validateTimetable(input);
  const store=createStore(resolve(args[dataIndex+1]));
  try{console.log(JSON.stringify(importTimetable(store,input,{dryRun:args.includes('--dry-run')})));}
  finally{store.close();}
}
