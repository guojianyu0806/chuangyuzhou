"""Archive authentic pre-competition releases with current Git dates; never rewrite main.

Original source directories and Codex logs are read-only. Only selected public
messages and the first six source patches are exported, never whole private logs.
"""
from pathlib import Path, PurePosixPath
import collections, datetime, hashlib, json, os, re, subprocess, tarfile

ROOT = Path(__file__).resolve().parent.parent
ORIGINAL = Path(r'C:\Users\g2806\Desktop\工作台')
RELEASES = ORIGINAL / '.workbench/releases'
LOG = Path(r'C:\Users\g2806\.codex\sessions\2026\09\19\rollout-2026-09-19T23-07-16-01a0ba35-1686-7b31-b2cd-2ee676a266b1.jsonl')
COMP_LOG = Path(r'C:\Users\g2806\.codex\sessions\2026\10\08\rollout-2026-10-08T19-16-44-01a11b3a-db07-7f61-8309-5436b1b2b971.jsonl')
OTHER_LOG = Path(r'C:\Users\g2806\.codex\sessions\2026\09\29\rollout-2026-09-29T14-31-14-01a0ebdc-3ec7-77f2-b13f-5e9af99ba8aa.jsonl')
OUT = ROOT / 'evidence/provenance/DEV-047'
BRANCH = 'codex/yuzhou-historical-snapshots'
IMPORT = 'ac7315842342698e0e81f5813aaa27faacbb4baf'
STRONG = re.compile(rb'(?<![A-Za-z0-9_])(?:sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})|-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s:/"<>]+:[^\s@/"<>]+@')
ASSIGN = re.compile(r'''(?i)(?:api[_-]?key|access[_-]?token|password|passwd|setupToken|client[_-]?secret)\s*["']?\s*[:=]\s*(["'])([^\n"']{8,})\1''')

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git(*args, data=None, env=None):
    return subprocess.check_output(['git', *args], cwd=ROOT, input=data, env=env)

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8', newline='\n') as f:
        f.write(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)+'\n')

def records(path):
    for n, raw in enumerate(path.open('rb'), 1):
        yield n, raw, json.loads(raw)

def text_of(payload):
    return '\n'.join(c.get('text', '') for c in payload.get('content', []) if isinstance(c, dict))

_blob_cache = {}
def blob(data):
    key=sha(data)
    if key not in _blob_cache:
        _blob_cache[key]=git('hash-object', '-w', '--stdin', data=data).decode().strip()
    return _blob_cache[key]

def tree(files):
    nested = {}
    for path, data in files.items():
        parts = PurePosixPath(path).parts
        target = nested
        for p in parts[:-1]:
            target = target.setdefault(p, {})
        target[parts[-1]] = blob(data)
    def build(items):
        rows=[]
        for name, entry in sorted(items.items()):
            mode, kind, oid = ('040000', 'tree', build(entry)) if isinstance(entry, dict) else ('100644', 'blob', entry)
            rows.append(f'{mode} {kind} {oid}\t{name}\0'.encode('utf-8'))
        return git('mktree', '-z', data=b''.join(rows)).decode().strip()
    return build(nested)

def main():
    assert not OUT.exists(), 'Never overwrite a previous evidence run'
    assert subprocess.run(['git', 'show-ref', '--verify', '--quiet', 'refs/heads/'+BRANCH], cwd=ROOT).returncode != 0
    before=git('rev-parse', 'HEAD').decode().strip()
    original_status=git('status', '--porcelain=v1', '-z')
    original_count=int(git('rev-list', '--count', 'HEAD'))
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    archives=[]; snapshots=[]; candidates=[]; unique={}
    for a in sorted(RELEASES.glob('*.tar.gz'), key=lambda p: p.name.split('-',3)[-1]):
        version=re.match(r'(\d+)-(\d+)-(\d+)-(\d{8})-(\d{6})', a.name)
        assert version
        v='.'.join(version.groups()[:3])
        after_fork=tuple(map(int,version.groups()[:3])) > (0,15,0)
        members={}
        with tarfile.open(a) as t:
            for m in t.getmembers():
                if m.isdir():
                    continue
                assert m.isfile(), f'Unexpected non-file archive member: {a.name}'
                path=PurePosixPath(m.name)
                assert not path.is_absolute() and '..' not in path.parts
                assert path.parts[0] in ('frontend','backend','deployment')
                assert path.suffix.lower() in ('.svg','.html','.webmanifest','.json','.mjs','.css','.js','.py','.md','.service','.caddy')
                members[m.name]=t.extractfile(m).read()
        entry={'archive':a.name,'version':v,'archiveSha256':sha(a.read_bytes()),'bytes':a.stat().st_size,'files':[{'path':p,'sha256':sha(b),'bytes':len(b)} for p,b in sorted(members.items())], 'relation':'personal-continuation-after-competition-fork' if after_fork else 'pre-competition-source-snapshot'}
        meta=a.with_name(a.name+'.json')
        if meta.exists():
            metadata=json.loads(meta.read_text(encoding='utf-8-sig'))
            entry['metadataSha256Matches']=metadata.get('sha256')==entry['archiveSha256']
            assert entry['metadataSha256Matches']
        archives.append(entry)
        if after_fork:
            continue
        for path,data in members.items():
            h=sha(data)
            if h in unique: continue
            assert not STRONG.search(data), f'Secret signature requires review: {path}'
            unique[h]=path
            s=data.decode('utf-8')
            for m in ASSIGN.finditer(s):
                v2=m.group(2)
                if any(x in v2 for x in ['${','=>','\\','join(','.get(','?.','opts.','config.','value.','entry.','new ','utf8','application/']): continue
                line=s.count('\n',0,m.start())+1
                cls='synthetic-test-value' if '/tests/' in path else 'ui-form-attribute' if v2=='current-password' else 'ui-error-message-map' if path=='frontend/src/cloud.js' and line==6 and re.search('[\u4e00-\u9fff]',v2) else 'REVIEW'
                assert cls!='REVIEW', f'Unreviewed assignment at {path}:{line}'
                candidates.append({'blobSha256':h,'path':path,'line':line,'classification':cls})
        snapshots.append((entry,members))
    # Source evidence exported separately from the newly written narrative.
    selected={9,118,171,419,3367}
    patches={133,487,497,508,524,562}
    exported=[]; patchrows=[]; gitchecks=[]; early=[]
    for n,raw,o in records(LOG):
        p=o.get('payload',{})
        if o.get('type')!='response_item': continue
        if n in selected:
            assert p.get('type')=='message' and p.get('role')=='user'
            message=text_of(p)
            assert not STRONG.search(message.encode())
            exported.append({'log':LOG.name,'line':n,'timestamp':o.get('timestamp'),'recordSha256':sha(raw),'role':'user','text':message})
        if n in patches:
            match=re.search(r'apply_patch\(("(?:[^"\\]|\\.)*")\)',p.get('input',''))
            assert match
            patch=json.loads(match[1]);assert not STRONG.search(patch.encode())
            path=f'initial-patches/{n:05d}.patch.txt';save(OUT/path,patch)
            early.append(patch)
            patchrows.append({'log':LOG.name,'line':n,'timestamp':o.get('timestamp'),'recordSha256':sha(raw),'path':path,'sha256':sha(patch.encode()),'scope':'selected initial patch; not a complete conversation or a complete runnable release'})
        if n in (2960,2963,5368,5371):
            # Do not export the surrounding deployment output, which contains private paths.
            content=json.dumps(p,ensure_ascii=False)
            excerpt='fatal: not a git repository (or any of the parent directories): .git' if n in (2963,5371) else 'git status --short'
            assert excerpt in content
            gitchecks.append({'log':LOG.name,'line':n,'timestamp':o.get('timestamp'),'recordSha256':sha(raw),'excerpt':excerpt,'excerptOnly':True})
    for n,raw,o in records(COMP_LOG):
        if n not in (451,1078,1191,2413):continue
        p=o.get('payload',{});assert p.get('type')=='message' and p.get('role')=='user'
        message=text_of(p);assert not STRONG.search(message.encode())
        exported.append({'log':COMP_LOG.name,'line':n,'timestamp':o.get('timestamp'),'recordSha256':sha(raw),'role':'user','text':message})
    assert len(exported)==9 and len(patchrows)==6 and len(gitchecks)==4
    # Search executed calls only: quoted web content and developer docs aren't Git history.
    command_counts={}
    for log in (LOG,OTHER_LOG):
        hits=[]
        for n,raw,o in records(log):
            p=o.get('payload',{})
            if o.get('type')!='response_item' or p.get('type') not in ('custom_tool_call','function_call'):continue
            s=str(p.get('input',p.get('arguments','')))
            for m in re.finditer(r'\bgit\s+(init|add|commit|log|status|push|remote|rev-parse|clone|bundle|reflog)\b',s):
                hits.append({'line':n,'verb':m[1]})
        command_counts[log.name]=hits
    # Verify exact release bytes -> original import manifest -> original Git import.
    manifest=json.loads((ROOT/'evidence/provenance/yuzhou-0.15.0-import.json').read_text(encoding='utf-8-sig'))
    mh={x['path']:x['sha256'] for x in manifest['files']}
    final_members=snapshots[-1][1]
    assert snapshots[-1][0]['version']=='0.15.0'
    assert all(mh[p]==sha(b) for p,b in final_members.items())
    batch=subprocess.Popen(['git','cat-file','--batch'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    imported=[]
    for x in manifest['files']:
        batch.stdin.write((IMPORT+':yuzhou/'+x['path']+'\n').encode());batch.stdin.flush()
        hdr=batch.stdout.readline().split();assert hdr[1]==b'blob';n=int(hdr[2]);b=batch.stdout.read(n);assert batch.stdout.read(1)==b'\n'
        original=(ORIGINAL/x['path']).read_bytes() if False else None
        exact=sha(b)==x['sha256']
        release_bytes=final_members.get(x['path'])
        normalized=(lambda v:v.replace(b'\r\r\n',b'\n').replace(b'\r\n',b'\n'))
        imported.append({'path':x['path'],'manifestSha256':x['sha256'],'gitBlobSha256':sha(b),'exact':exact,'releaseAvailable':release_bytes is not None,'releaseEqualsGitIgnoringLineEndings':normalized(release_bytes)==normalized(b) if release_bytes is not None else None})
    batch.stdin.close();batch.wait()
    assert all(x['exact'] or x['releaseEqualsGitIgnoringLineEndings'] for x in imported if x['releaseAvailable'])
    # No checkout/index/worktree mutation: append current-date commits via Git plumbing.
    parent=None; previous={}; commits=[]
    for index,(entry,members) in enumerate(snapshots,1):
        current={p:sha(b) for p,b in members.items()}
        delta={'added':sorted(current.keys()-previous.keys()),'deleted':sorted(previous.keys()-current.keys()),'changed':sorted(p for p in current.keys()&previous.keys() if current[p]!=previous[p])}
        metadata={k:v for k,v in entry.items() if k!='files'}
        metadata.update({'recordedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':'historical-source-snapshot-recorded-now','sourceSubset':'files present in the retained deployment archive, not an entire original workspace','mainBaselinePreserved':before,'deltaFromPreviousArchive':delta})
        readme=f'''# 宇宙 {entry['version']} · 历史源码快照补录

这条 Git 提交是在 {metadata['recordedAtUtc']} 根据留存发布包补录的。
原发布包：`{entry['archive']}`，SHA-256：`{entry['archiveSha256']}`。

`source/` 原样保存发布包中的 {len(members)} 个文件；时间标记取自旧包名称，不能视为当时已存在 Git 提交或可信第三方时间戳。原始项目当时未检出 Git 历史。本分支是现在建立的版本对照，提交作者和提交时间均使用本次真实记录身份与时间。

本分支截至比赛复制的个人版 0.15.0。个人版后续 0.16/0.17 不属于比赛前置历史。
比赛主线原有 {original_count} 条提交及 SHA 保留；它导入 0.15.0 的真实提交为 `{IMPORT}`。
本分支没有伪接为比赛主线的父提交，也不代表旧版已重新运行验收。旧部署脚本仅为来源证据，不应直接运行。
'''
        files={'source/'+p:b for p,b in members.items()}
        files['README.md']=readme.encode();files['snapshot.json']=(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n').encode()
        oid=tree(files)
        env=os.environ.copy()
        env['GIT_AUTHOR_DATE']=metadata['recordedAtUtc'];env['GIT_COMMITTER_DATE']=metadata['recordedAtUtc']
        args=['commit-tree',oid]+(['-p',parent] if parent else [])
        message=f"archive(snapshot): 补录宇宙{entry['version']} · {entry['archive']}\n\nRecorded now from a retained source archive; NOT an original historical Git commit.\nArchive-SHA256: {entry['archiveSha256']}\nRecorded-At: {metadata['recordedAtUtc']}\n"
        parent=git(*args,data=message.encode(),env=env).decode().strip()
        commits.append({'index':index,'commit':parent,'tree':oid,'archive':entry['archive'],'version':entry['version'],'recordedAtUtc':metadata['recordedAtUtc'],'archiveSha256':entry['archiveSha256'],'fileCount':len(members),'delta':delta})
        previous=current
    git('update-ref','refs/heads/'+BRANCH,parent,'0'*40)
    assert git('rev-parse','HEAD').decode().strip()==before
    assert int(git('rev-list','--count','HEAD'))==original_count
    assert git('status','--porcelain=v1','-z')==original_status or b'evidence/provenance/DEV-047/' in git('status','--porcelain=v1','-z')
    result={'recordedAtUtc':now,'kind':'retrospective-provenance-supplement','originalGitFound':False,'originalGitPathsChecked':[str(ORIGINAL / p / '.git') for p in ('','frontend','backend','deployment','mobile')], 'originalGitCommandEvidence':gitchecks,'executedGitCallsInTwoOriginalChats':command_counts,'mainHeadUnchanged':before,'mainCommitCountUnchanged':original_count,'branch':BRANCH,'branchTip':parent,'snapshotCommitCount':len(commits),'archiveCount':len(archives),'postForkPersonalReleasesExcluded':len(archives)-len(commits),'archiveUniqueSourceBlobsScanned':len(unique),'strongCredentialSignatureMatches':0,'reviewedAssignmentCandidates':candidates,'initialPatchCount':len(patchrows),'publicUserMessagesSelected':len(exported),'archiveToImportManifestExactFileMatches':len(final_members),'manifestFileCount':len(manifest['files']),'importGitExactFileMatches':sum(x['exact'] for x in imported),'archiveToImportGitLineEndingOnlyDifferences':sum(x['releaseAvailable'] and not x['exact'] and x['releaseEqualsGitIgnoringLineEndings'] for x in imported),'limitations':['No original early Git commits recovered; supplementary commits have current dates.','Archive snapshots contain deployment source subsets, not every intermediate edit or complete workspaces.','Selected initial patches are excerpts and do not reconstruct a tested complete first release.','Local files and chat record hashes support traceability, not independently trusted creation timestamps.','Secret signature scanning and candidate review cannot guarantee absence of every secret format.','Competition acceptance of retrospective records has not been confirmed.','No source archive execution, service restart, model request or public upload performed.']}
    save(OUT/'selected-user-messages.json',exported)
    save(OUT/'initial-patch-index.json',patchrows)
    save(OUT/'archive-manifests.json',archives)
    save(OUT/'snapshot-commits.json',commits)
    save(OUT/'import-comparison.json',imported)
    save(OUT/'verification.json',result)
    print(json.dumps({k:result[k] for k in ('mainHeadUnchanged','mainCommitCountUnchanged','branch','branchTip','snapshotCommitCount','archiveCount','postForkPersonalReleasesExcluded','archiveUniqueSourceBlobsScanned','archiveToImportManifestExactFileMatches','importGitExactFileMatches','archiveToImportGitLineEndingOnlyDifferences')},ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()
