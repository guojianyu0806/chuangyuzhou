// Read only the public source files listed during import. Never enumerate runtime data.
import {readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute,parse} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(resolve(root,'evidence/provenance/yuzhou-0.15.0-import.json'),'utf8'));
const source=resolve('C:/Users/g2806/Desktop/工作台');
if(resolve(manifest.sourceRoot)!==source)throw Error('Unexpected source root');
const results=manifest.files.map(item=>{
 const file=resolve(source,item.path),part=relative(source,file);
 if(!part||part.startsWith('..')||isAbsolute(part))throw Error('Invalid manifest path');
 for(let p=file;;p=dirname(p)){
  const stat=lstatSync(p);
  if(stat.isSymbolicLink()||(stat.isFile()&&stat.nlink>1)||realpathSync(p).toLowerCase()!==p.toLowerCase())throw Error('Linked source rejected');
  if(p===parse(p).root)break;
 }
 const sha256=createHash('sha256').update(readFileSync(file)).digest('hex');
 return {path:item.path,unchanged:sha256===item.sha256};
});
const report={checkedAtUtc:new Date().toISOString(),sourceRoot:source,checkedFiles:results.length,allUnchanged:results.every(x=>x.unchanged),scope:'Only the 150 public files selected in the import manifest; no claim about uninspected private data.',results};
const reportPath=resolve(root,'evidence/engineering/DEV-002-source-preserved.json');
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({checkedFiles:report.checkedFiles,allUnchanged:report.allUnchanged,reportPath}));
if(!report.allUnchanged)process.exitCode=1;
