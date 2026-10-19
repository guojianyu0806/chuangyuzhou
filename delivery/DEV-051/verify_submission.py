from pathlib import Path
import subprocess,json,hashlib,zipfile
ROOT=Path(__file__).resolve().parents[2]
def git(*a):return subprocess.check_output(['git',*a],cwd=ROOT)
def sha(b):return hashlib.sha256(b).hexdigest()
manifest=json.loads((ROOT/'submission/创宇宙-v2/SOURCE-MANIFEST.json').read_text(encoding='utf-8'))
proc=subprocess.Popen(['git','cat-file','--batch'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
def staged(path):
    proc.stdin.write((':'+path+'\n').encode('utf-8'));proc.stdin.flush()
    header=proc.stdout.readline().split();assert len(header)==3,header
    result=proc.stdout.read(int(header[2]));proc.stdout.read(1);return result
for row in manifest['files']:
    data=staged('submission/创宇宙-v2/'+row['path'])
    assert sha(data)==row['sha256'],row['path']
zpath=ROOT/'delivery/2026-10-19_创宇宙正式提交_v2/创宇宙_源码_正式提交版_v2.zip'
with zipfile.ZipFile(zpath) as z:
    assert len(z.namelist())==297
    for row in manifest['files']:assert sha(z.read(row['path']))==row['sha256']
for folder in ['delivery/2026-10-19_创宇宙正式提交_v2','delivery/2026-10-19_创宇宙网盘提交_v2']:
    for line in (ROOT/folder/'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines():
        digest,name=line.split('  ',1)
        assert sha((ROOT/folder/name).read_bytes())==digest,name
        if folder.endswith('正式提交_v2'):
            assert sha(staged(folder+'/'+name))==digest,name
before=json.loads((ROOT/'.local/dev051/preserved-v1.json').read_text(encoding='utf-8'))
for path,digest in before.items():assert sha((ROOT/path).read_bytes())==digest,path
staged=git('diff','--cached','--name-only','-z').decode('utf-8').split('\0')
assert not any('DEV-032' in s or s.startswith('正式视频/') or '网盘提交' in s for s in staged)
proc.stdin.close();proc.wait()
print(json.dumps({'stagedPackageFilesVerified':len(manifest['files']),'zipMembers':297,'oldFilesPreserved':len(before),'stagedFiles':len([s for s in staged if s]),'unrelatedUserEditsStaged':False},ensure_ascii=False))
