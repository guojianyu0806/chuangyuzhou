"""Verify the deliverables and preserve old artifact hashes before final copying."""
from pathlib import Path
import hashlib,json,re,zipfile,subprocess
from pypdf import PdfReader
from PIL import Image,ImageChops
ROOT=Path(__file__).resolve().parent.parent
FINAL=ROOT/'delivery/2026-10-19_创宇宙正式提交_v1'
def sha(data):return hashlib.sha256(data).hexdigest()
def write_new(p,data):
    with p.open('xb') as f:f.write(data)

before=json.loads((ROOT/'evidence/engineering/DEV-045-preservation-before.json').read_text('utf8'))
for item in before['files']:
    assert sha((ROOT/item['path']).read_bytes())==item['sha256'],item['path']
assert not subprocess.check_output(['git','diff','--name-only','9c567d7','--','yuzhou'],cwd=ROOT).strip()
archive=FINAL/'创宇宙_源码_正式提交版_v1.zip'
with zipfile.ZipFile(archive) as z:
    assert len(z.namelist())==len(set(z.namelist()))==297
    assert z.testzip() is None
    manifest=json.loads(z.read('SOURCE-MANIFEST.json'))
    for row in manifest['files']:
        data=z.read(row['path']);assert len(data)==row['bytes'] and sha(data)==row['sha256']
    assert z.read('README.md')==(FINAL/'README.md').read_bytes()
    assert z.read('README.md')==(ROOT/'delivery/DEV-045/README-template.md').read_bytes()
    assert b'<title>'+ '创宇宙'.encode()+b'</title>' in z.read('yuzhou/frontend/index.html')
    assert json.loads(z.read('yuzhou/frontend/manifest.webmanifest'))['name']=='创宇宙'
    bad=[]
    patterns={
        'known-credential':rb'sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
        'personal-path':rb'C:[/\\]Users[/\\]g2806|203\.195\.191\.239',
    }
    broken=[]
    for name in z.namelist():
        data=z.read(name)
        for kind,pattern in patterns.items():
            if re.search(pattern,data):bad.append({'path':name,'kind':kind,'value':'withheld'})
        assert not re.search(r'(^|/)(\.git|\.cu-runtime|node_modules|\.env)(/|$)|\.(db|sqlite|p12|keystore|jks)$',name,re.I)
        # Disabled historical browser scripts contain dynamically rewritten import strings.
        # Their fixtures are not part of the runnable module graph.
        legacy=name.startswith('yuzhou/frontend/tests/') and name.endswith('.mjs') and not name.endswith('.test.mjs')
        if name.endswith(('.mjs','.js')) and not legacy:
            s=data.decode('utf8')
            for match in re.finditer(r'(?:from\s*|import\s*\()([\'\"])(\.[^\'\"]+)\1',s):
                target=(ROOT/'.local/dev045/package'/Path(name).parent/match[2]).resolve()
                if not target.is_file():broken.append({'file':name,'import':match[2]})
    assert not bad,bad
    assert not broken,broken
    app_count=sum(n.startswith('yuzhou/') for n in z.namelist())

pdf=ROOT/'.local/dev045/pdf-v3/创宇宙_技术文档_正式提交版_v1.pdf'
reader=PdfReader(pdf);assert len(reader.pages)==13
texts=[p.extract_text() for p in reader.pages];whole='\n'.join(texts)
assert '创宇宙' in texts[0] and '861' in whole and '862' in whole and '9c567d7d3c3a' in whole
for stale in ['a96689c79bc3','677e6ce','134条','7.514','28.638','DEV-031-clean']:
    assert stale not in whole,stale
assert not re.search(patterns['known-credential'],whole.encode())
assert not re.search(patterns['personal-path'],whole.encode())
fonts=[]
for p in reader.pages:
    for ref in p['/Resources']['/Font'].values():
        font=ref.get_object();ds=font.get('/DescendantFonts') or [font]
        for d in ds:
            desc=d.get_object().get('/FontDescriptor')
            if desc: fonts.append(any(k in desc.get_object() for k in ['/FontFile','/FontFile2','/FontFile3']))
assert fonts and all(fonts)
same=[]
for n in range(1,14):
    with Image.open(ROOT/f'.local/dev045/pdf-render-v2/page-{n:02d}.png') as a,Image.open(ROOT/f'.local/dev045/pdf-render-v3/page-{n:02d}.png') as b:
        if ImageChops.difference(a,b).getbbox() is None:same.append(n)
assert same==[1,*range(3,14)]
write_new(FINAL/pdf.name,pdf.read_bytes())

ui_results=[]
for p in (ROOT/'evidence/engineering/DEV-045-ui').rglob('result-*.json'):
    value=json.loads(p.read_text('utf8'));ui_results.append((p,value))
passed=[(p,v) for p,v in ui_results if v['status']=='passed'];assert len(passed)==1
assert passed[0][1]['ownedServerStopped']
tap=(ROOT/'evidence/engineering/DEV-045-submit-tests.tap').read_text('utf8')
stats={k:int(re.findall(r'^# '+k+r' (\d+)$',tap,re.M)[-1]) for k in ['tests','pass','fail','skipped']}
assert stats=={'tests':862,'pass':861,'fail':0,'skipped':1}
result={'status':'passed','sourceCommit':manifest['sourceCommit'],'archiveFiles':297,'applicationTreeFiles':app_count,'archiveSha256':sha(archive.read_bytes()),'pdfPages':13,'pdfSha256':sha(pdf.read_bytes()),'pdfFontsEmbedded':True,'pdfVisualReview':'All 13 v2 rendered pages visually reviewed; v3 page 2 reviewed separately; all other 12 pages pixel-identical','pdfUnchangedPagesComparedWithReviewedV2':same,'sourceImportLinksResolved':True,'readmeExactMatch':True,'protectedOldArtifactsUnchanged':len(before['files']),'activeSourceUnchanged':True,'knownCredentialMatches':0,'machinePrivateReferenceMatches':0,'fullHistoricalSecretAudit':False,'tests':stats,'uiReport':passed[0][0].relative_to(ROOT).as_posix(),'uiEarlierHarnessFailures':sum(v['status']=='failed' for _,v in ui_results),'modelRequestsThisTurn':0,'uploaded':False,'limitations':['No audit of all historical Git blobs','No new real model run','No independent user trial or second device test','Video content not re-audited in this scope']}
write_new(ROOT/'evidence/engineering/DEV-045-final-verification.json',(json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode())
print(json.dumps(result,ensure_ascii=False,indent=2))
