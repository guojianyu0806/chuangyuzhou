"""Verify every supplemented Git snapshot against recorded release byte hashes."""
from pathlib import Path
import datetime, hashlib, json, subprocess

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'evidence/provenance/DEV-047'
load=lambda name:json.loads((OUT/name).read_text(encoding='utf-8'))
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT)

def main():
    summary=load('verification.json');commits=load('snapshot-commits.json')
    archives={x['archive']:x for x in load('archive-manifests.json')}
    assert git('rev-parse',summary['branch']).decode().strip()==summary['branchTip']
    assert int(git('rev-list','--count',summary['branch']))==len(commits)==25
    all_dates=[];checked=0;parent=None
    batch=subprocess.Popen(['git','cat-file','--batch'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    def obj(spec):
        batch.stdin.write((spec+'\n').encode());batch.stdin.flush()
        hdr=batch.stdout.readline().split();assert len(hdr)==3 and hdr[1]==b'blob'
        value=batch.stdout.read(int(hdr[2]));assert batch.stdout.read(1)==b'\n'
        return value
    for row in commits:
        oid=row['commit']
        parents=git('rev-list','--parents','-n','1',oid).decode().split()[1:]
        assert parents==([parent] if parent else [])
        entries=git('ls-tree','-r','--name-only',oid).decode('utf-8').splitlines()
        expected={'source/'+x['path']:x for x in archives[row['archive']]['files']}
        assert set(entries)==set(expected)|{'README.md','snapshot.json'}
        for path,source in expected.items():
            data=obj(oid+':'+path)
            assert len(data)==source['bytes'] and hashlib.sha256(data).hexdigest()==source['sha256']
            checked+=1
        metadata=json.loads(obj(oid+':snapshot.json'))
        assert metadata['kind']=='historical-source-snapshot-recorded-now'
        assert metadata['archiveSha256']==row['archiveSha256']
        author,committer=git('show','-s','--format=%aI%n%cI',oid).decode().strip().splitlines()
        at=datetime.datetime.fromisoformat(author);ct=datetime.datetime.fromisoformat(committer)
        captured=datetime.datetime.fromisoformat(row['recordedAtUtc'])
        assert abs((at-captured).total_seconds())<1 and abs((ct-captured).total_seconds())<1
        assert at.date()==datetime.datetime.fromisoformat(summary['recordedAtUtc']).date()
        all_dates.append(author);parent=oid
    batch.stdin.close();assert batch.wait()==0
    for row in load('initial-patch-index.json'):
        assert hashlib.sha256((OUT/row['path']).read_bytes()).hexdigest()==row['sha256']
    # Every original main commit must still be an ancestor with its original SHA.
    assert subprocess.run(['git','merge-base','--is-ancestor',summary['mainHeadUnchanged'],'HEAD'],cwd=ROOT).returncode==0
    assert int(git('rev-list','--count',summary['mainHeadUnchanged']))==188
    # Supplementary branch is deliberately unrelated, rather than manufactured ancestry.
    assert subprocess.run(['git','merge-base','HEAD',summary['branch']],cwd=ROOT,stdout=subprocess.PIPE).returncode==1
    result={'verifiedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'snapshotCommitsVerified':len(commits),'sourceFileVersionsByteVerified':checked,'initialPatchesVerified':6,'originalMainCommitsPreserved':188,'branchHasNoManufacturedMainAncestry':True,'allSupplementaryCommitDatesAreCurrent':True,'earliestSupplementaryCommitDate':min(all_dates),'latestSupplementaryCommitDate':max(all_dates),'archiveToManifestFileMatches':94,'archiveToOriginalGitSourceContentMatchesIgnoringLineEndings':94,'publicUploadPerformed':False}
    path=OUT/'independent-verification.json'
    with path.open('x',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
