"""Audit the exact two public branches; never enumerate/private-push checkpoints."""
from pathlib import Path
import subprocess,re,json,hashlib,collections,datetime

ROOT=Path(__file__).resolve().parent.parent
BASE='96bdda69beccf77910b92f2699a4726e90b4711d'
REFS=['main','codex/yuzhou-historical-snapshots']
OUT=ROOT/'.local/dev049'

def git(*args,data=None):return subprocess.check_output(['git',*args],cwd=ROOT,input=data)

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    entries=git('rev-list','--objects',*REFS).decode('utf8').splitlines()
    checked=git('cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize) %(rest)',data=('\n'.join(entries)+'\n').encode()).decode('utf8').splitlines()
    rows=[x.split(' ',3) for x in checked]
    base_objects=set(x.split()[0] for x in git('rev-list','--objects',BASE).decode().splitlines())
    counts=collections.Counter(x[1] for x in rows)
    strong=re.compile(rb'(?<![A-Za-z0-9_])(?:sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})|-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----')
    bearer=re.compile(rb'Bearer\s+[A-Za-z0-9_.-]{20,}')
    url=re.compile(rb'(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s:/"<>]+:[^\s@/"<>]+@')
    fixture=re.compile(rb'(?i)synthetic|fixture|example|placeholder|dummy|fake|test[-_ ]|not-real|no-network|REDACTED|change-me')
    findings=[];new_media=[];blocked=[];scanned=0
    batch=subprocess.Popen(['git','cat-file','--batch'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    for parts in rows:
        oid,typ,size=parts[:3];path=parts[3] if len(parts)>3 else ''
        if typ not in ('blob','commit','tag'):continue
        batch.stdin.write((oid+'\n').encode());batch.stdin.flush();h=batch.stdout.readline().split();value=batch.stdout.read(int(h[2]));assert batch.stdout.read(1)==b'\n'
        scanned+=1
        if typ=='blob' and oid not in base_objects and (value.startswith(b'%PDF-') or value.startswith(b'\x89PNG\r\n\x1a\n') or value.startswith(b'\xff\xd8\xff') or Path(path).suffix.lower() in ('.m4a','.mp3','.wav','.mp4')):new_media.append({'object':oid,'path':path})
        for kind,pattern in [('provider-or-private-key',strong),('bearer-literal',bearer),('credential-url',url)]:
            for m in pattern.finditer(value):
                is_test=('/tests/' in path or '.test.' in path or bool(fixture.search(m.group())))
                row={'object':oid,'path':path,'kind':kind,'alreadyAuditedIn188CommitBaseline':oid in base_objects,'fixtureContext':is_test,'candidateSha256':hashlib.sha256(m.group()).hexdigest()}
                findings.append(row)
                if oid not in base_objects and not is_test:blocked.append(row)
    batch.stdin.close();assert batch.wait()==0
    assert not new_media,'New binary media require separate review'
    assert not blocked,'New credential signatures require review; values withheld'
    assert subprocess.run(['git','merge-base','--is-ancestor',BASE,'main'],cwd=ROOT).returncode==0
    commits={ref:int(git('rev-list','--count',ref)) for ref in REFS}
    audio=[{'object':p[0],'path':p[3]} for p in rows if len(p)>3 and p[1]=='blob' and Path(p[3]).suffix.lower() in ('.m4a','.mp3','.wav')]
    assert not audio,'Audio unexpectedly reachable in public refs'
    preparation=json.loads((ROOT/'evidence/engineering/DEV-049-publication-preparation.json').read_text(encoding='utf8'))
    copied=ROOT/preparation['sourceDirectory']
    for x in preparation['files']:
        b=(copied/x['path']).read_bytes();assert hashlib.sha256(b).hexdigest()==x['sha256']
    previous=json.loads((ROOT/'evidence/engineering/DEV-046-history-audit-summary.json').read_text(encoding='utf8'))
    assert previous['auditHead']==BASE and previous['confirmedLiveSecrets']==0 and previous['formalImageCount']==96
    result={'auditedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'refs':{ref:git('rev-parse',ref).decode().strip() for ref in REFS},'commitCounts':commits,'publicReachableObjects':dict(counts),'objectsScanned':scanned,'original188CommitBaselinePreserved':True,'baselineAudit':{'credentialCandidatesReviewed':182,'screenshotsOcrAndVisuallyReviewed':96,'pdfTextsScanned':2,'zipMembersScanned':297},'newBinaryMedia':new_media,'publicAudioCount':len(audio),'signatureCandidates':findings,'unresolvedNewSignatureCandidates':0,'formalSourceCopyByteVerified':len(preparation['files']),'originalShaRewritten':False,'authorizedHistoricalMetadataRetained':True,'checkpointRefsSelectedForPublication':False,'gitMirrorUsed':False,'remotePublicationPerformedByThisScript':False,'limitations':['Pattern scans do not cover every possible secret encoding.','Original personal metadata and server address remain under explicit user authorization.','Snapshot history remains retrospective; no claim of official competition approval.']}
    with (OUT/'public-ref-audit.json').open('x',encoding='utf8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps({k:result[k] for k in ['refs','commitCounts','publicReachableObjects','objectsScanned','newBinaryMedia','publicAudioCount','unresolvedNewSignatureCandidates','formalSourceCopyByteVerified']},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
