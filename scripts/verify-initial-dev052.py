"""Verify the selected early evidence, old-file preservation and attachment contents."""
from pathlib import Path
import argparse,datetime,hashlib,json,re,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/provenance/DEV-052'
def sha(b):return hashlib.sha256(b).hexdigest()
def git(*a):return subprocess.check_output(['git',*a],cwd=ROOT)
def localverify(source=None):
    m=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
    for group in ['patches','messages','runtimeRecords']:
        for x in m[group]:assert sha((OUT/x['path']).read_bytes())==x['sha256'],x['path']
    assert [len(m[x]) for x in ['patches','messages','runtimeRecords']]==[17,9,11]
    if source:
        rows={};prefix=hashlib.sha256();size=0
        with Path(source).open('rb') as f:
            for n,line in enumerate(f,1):
                if n>m['source']['prefixThroughLine']:break
                rows[n]=line;prefix.update(line);size+=len(line)
        assert prefix.hexdigest()==m['source']['prefixSha256'] and size==m['source']['prefixBytes']
        markers=[]
        for x in m['patches']+m['messages']:markers.extend([x]+([x['result']] if 'result' in x else []))
        for x in m['runtimeRecords']:
            record=json.loads((OUT/x['path']).read_text(encoding='utf-8'));markers.extend([record,record['result']])
        for marker in markers:assert sha(rows[marker['sourceLine']])==marker['sourceRecordSha256']
    before=json.loads((ROOT/'.local/dev052/before.json').read_text(encoding='utf-8')) if (ROOT/'.local/dev052/before.json').exists() else None
    if before:
        for name,digest in before['preservedFiles'].items():assert sha((ROOT/name).read_bytes())==digest,name
        assert git('rev-parse','codex/yuzhou-historical-snapshots').decode().strip()==before['snapshotHead']
        assert set(before['mainCommits']).issubset(set(git('rev-list','HEAD').decode().splitlines()))
    paths=list(OUT.rglob('*'))+[ROOT/'docs/创宇宙-早期开发与Git补录说明-v3.md']
    # Strong signatures only. Values are never printed if a match occurs.
    strong=re.compile(rb'(?<![A-Za-z0-9_])(?:sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})|-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s:/"<>]+:[^\s@/"<>]+@')
    assignment=re.compile(r'''(?i)(?:api[_-]?key|access[_-]?token|password|passwd|setupToken|client[_-]?secret)\s*["']?\s*[:=]\s*(["'])([^\n"']{8,})\1''')
    assignment_candidates=[];scan_count=0;links=0
    for p in paths:
        if not p.is_file():continue
        data=p.read_bytes();scan_count+=1
        assert not strong.search(data),'Review credential signature in '+str(p.relative_to(ROOT))
        text=data.decode('utf-8')
        for hit in assignment.finditer(text):assignment_candidates.append({'path':p.relative_to(ROOT).as_posix(),'line':text.count('\n',0,hit.start())+1,'candidateSha256':sha(hit[2].encode()),'length':len(hit[2])})
        if p.suffix=='.md':
            for target in re.findall(r'\]\(([^)]+)\)',text):
                if target.startswith(('http:','https:','#')):continue
                assert (p.parent/target.split('#')[0]).resolve().exists(),(p,target)
                links+=1
    assert not assignment_candidates,assignment_candidates
    old=json.loads((ROOT/'evidence/provenance/DEV-047/initial-patch-index.json').read_text(encoding='utf-8'))
    assert all(next(x for x in m['patches'] if x['sourceLine']==p['line'])['sha256']==p['sha256'] for p in old)
    old_zip=ROOT/'delivery/2026-10-19_创宇宙网盘提交_v2/创宇宙_AI开发过程证据_提交附件_v2.zip'
    new_zip=ROOT/'delivery/2026-10-20_创宇宙开发过程补充_v1/创宇宙_AI开发过程证据_提交附件_v3.zip'
    with zipfile.ZipFile(new_zip) as newz:
        assert len(set(newz.namelist()))==len(newz.namelist())
        assert newz.testzip() is None
        if old_zip.exists():
            with zipfile.ZipFile(old_zip) as oldz:
                for name in oldz.namelist():assert oldz.read(name)==newz.read(name),name
        for p in paths:
            if p.is_file():assert newz.read(p.relative_to(ROOT).as_posix())==p.read_bytes(),p
        zip_members=len(newz.namelist())
    for folder in ['delivery/2026-10-20_创宇宙开发过程补充_v1','delivery/2026-10-20_创宇宙网盘提交_v3']:
        for line in (ROOT/folder/'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines():
            digest,name=line.split('  ',1);assert sha((ROOT/folder/name).read_bytes())==digest,name
    return {'verifiedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'patches':17,'userMessages':9,'runtimeRecords':11,
            'sourcePrefixVerified':bool(source),'originalSixPatchBytesMatch':True,'scannedPublicFiles':scan_count,'strongCredentialMatches':0,
            'assignmentCandidates':assignment_candidates,'localLinksVerified':links,'attachmentMembers':zip_members,
            'v2AttachmentMembersPreserved':True if old_zip.exists() else None,'priorFilesUnchanged':len(before['preservedFiles']) if before else None,
            'snapshotBranchUnchanged':True if before else None,'historicalCodeExecuted':False,'complete010SourceRecovered':False}
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source-log');parser.add_argument('--report');args=parser.parse_args()
    result=localverify(args.source_log)
    if args.report:
        p=(ROOT/args.report).resolve();assert p.is_relative_to(ROOT)
        p.parent.mkdir(parents=True,exist_ok=True)
        with p.open('x',encoding='utf-8',newline='\n') as f:json.dump(result,f,ensure_ascii=False,indent=2);f.write('\n')
    print(json.dumps(result,ensure_ascii=False))
