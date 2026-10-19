"""Verify the published repository with no cookies, auth headers or Git credentials."""
from pathlib import Path
import concurrent.futures,datetime,hashlib,json,os,subprocess,urllib.request,urllib.parse

ROOT=Path(__file__).resolve().parent.parent
REPO='https://github.com/guojianyu0806/chuangyuzhou'
RAW='https://raw.githubusercontent.com/guojianyu0806/chuangyuzhou/'
PROXY='http://127.0.0.1:7897'
DEST=ROOT/'.local/dev049/anonymous-checkout-v1'
NODE=ROOT/'.local/dev031-tools/node22/node-v22.23.3-win-x64/node.exe'

def git(*args,cwd=ROOT,env=None):return subprocess.check_output(['git',*args],cwd=cwd,env=env)
def sha(b):return hashlib.sha256(b).hexdigest()
def safe_url(s):return urllib.parse.quote(s,safe=':/?#=&%')

def main():
    assert not DEST.exists(),'Preserve previous verification checkout'
    refs=['main','codex/yuzhou-historical-snapshots']
    targets={r:git('rev-parse',r).decode().strip() for r in refs}
    first=git('rev-list','--max-parents=0','main').decode().strip()
    formal='delivery/2026-10-19_创宇宙正式提交_v1/'
    cases=[
        ('repository',REPO,None),
        ('main-commit-list',REPO+'/commits/main',None),
        ('original-first-commit',REPO+'/commit/'+first,None),
        ('retrospective-branch',REPO+'/tree/codex/yuzhou-historical-snapshots',None),
        ('root-readme',RAW+'main/README.md',sha((ROOT/'README.md').read_bytes())),
        ('formal-source-readme',RAW+'main/submission/创宇宙-v1/README.md',sha((ROOT/'submission/创宇宙-v1/README.md').read_bytes())),
        ('formal-source-zip',RAW+'main/'+formal+'创宇宙_源码_正式提交版_v1.zip','1ec8fabc592472f612c298016545152b7e3f65dae083d2218adb89ebfb6f60b3'),
        ('technical-pdf',RAW+'main/'+formal+'创宇宙_技术文档_正式提交版_v1.pdf','bc1433225ecf17ccea9a696f0b58e2493d073fd52ce71d09730d2feb61199705'),
    ]
    def fetch(case):
        name,url,expected=case
        # A new opener per request, with no CookieJar/Auth handlers or connection cookies.
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({'http':PROXY,'https':PROXY}))
        try:
            with opener.open(urllib.request.Request(safe_url(url),headers={'User-Agent':'Chuangyuzhou-anonymous-review-check'}),timeout=40) as r:
                b=r.read();row={'name':name,'url':url,'status':r.status,'bytes':len(b),'sha256':sha(b),'authenticationSent':False,'cookiesSent':False}
                if expected:row['expectedSha256']=expected;row['byteHashMatches']=sha(b)==expected
                assert r.status==200 and (expected is None or row['byteHashMatches'])
                return row
        except Exception as exc:return {'name':name,'url':url,'error':type(exc).__name__+': '+str(exc)[:200],'authenticationSent':False,'cookiesSent':False}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:checks=list(pool.map(fetch,cases))
    env=os.environ.copy();env.update({'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'NUL','GIT_TERMINAL_PROMPT':'0','GCM_INTERACTIVE':'never'})
    env.pop('GIT_ASKPASS',None);env.pop('SSH_ASKPASS',None)
    command=['git','-c','http.proxy='+PROXY,'-c','credential.helper=','-c','http.extraHeader=','-c','http.cookieFile=','-c','http.saveCookies=false','-c','core.autocrlf=false','-c','core.longpaths=true','clone','--quiet','--branch','main',REPO+'.git',str(DEST)]
    subprocess.run(command,cwd=ROOT,env=env,check=True,timeout=240)
    count={};commit_sets={}
    for ref in refs:
        remote='refs/remotes/origin/'+ref
        assert git('rev-parse',remote,cwd=DEST).decode().strip()==targets[ref]
        original=set(git('rev-list',ref).decode().splitlines())
        fetched=set(git('rev-list',remote,cwd=DEST).decode().splitlines())
        assert fetched==original
        count[ref]=len(fetched);commit_sets[ref]=True
    assert subprocess.run(['git','merge-base','--is-ancestor','96bdda69beccf77910b92f2699a4726e90b4711d','main'],cwd=DEST).returncode==0
    source_check=json.loads(subprocess.check_output([str(NODE),str(DEST/'submission/创宇宙-v1/tools/verify-source.mjs')],cwd=DEST))
    startup_check=json.loads(subprocess.check_output([str(NODE),str(DEST/'submission/创宇宙-v1/tools/start.mjs'),'--check'],cwd=DEST))
    preparation=json.loads((ROOT/'evidence/engineering/DEV-049-publication-preparation.json').read_text(encoding='utf8'))
    for x in preparation['files']:
        assert sha((DEST/'submission/创宇宙-v1'/x['path']).read_bytes())==x['sha256']
    for name,expected in [('创宇宙_源码_正式提交版_v1.zip',cases[-2][2]),('创宇宙_技术文档_正式提交版_v1.pdf',cases[-1][2])]:
        assert sha((DEST/formal/name).read_bytes())==expected
    receipt={'verifiedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'repositoryUrl':REPO,'anonymousHttpChecks':checks,'allAnonymousHttpChecksPassed':all(x.get('status')==200 for x in checks),'anonymousCloneSucceeded':True,'gitCredentialHelpersDisabled':True,'gitGlobalAndSystemConfigDisabled':True,'gitCookiesAndAuthHeadersDisabled':True,'branchHeads':targets,'branchCommitCounts':count,'fullCommitSetsMatchLocal':commit_sets,'original188CommitBaselinePreserved':True,'sourceByteCheck':source_check,'startupPreflight':startup_check,'all297CopiedFilesMatch':True,'zipAndPdfMatchOriginalArtifacts':True,'snapshotDatesRemainRetrospective':True,'paidModelCalled':False,'limitations':['Network checks prove unauthenticated access from the tested network path, not every region or future uptime.','No competition submission or official eligibility ruling performed.','The 25 supplementary commits are current-date source snapshots, not original early Git history.']}
    out=ROOT/'evidence/engineering/DEV-049-github-public-verification.json'
    with out.open('x',encoding='utf8') as f:json.dump(receipt,f,ensure_ascii=False,indent=2)
    print(json.dumps({'anonymousChecks':[(x['name'],x.get('status',x.get('error'))) for x in checks],'anonymousCloneSucceeded':True,'branchHeads':targets,'branchCommitCounts':count,'all297CopiedFilesMatch':True,'sourceByteCheck':source_check,'startupPreflight':startup_check},ensure_ascii=False,indent=2))
    assert receipt['allAnonymousHttpChecksPassed'],'Some HTTP views failed; inspect receipt before claiming complete access'

if __name__=='__main__':main()
