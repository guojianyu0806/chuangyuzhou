"""Read-only evidence checks plus a new, exclusive material-verification report."""
from pathlib import Path
import re, json, hashlib, subprocess
from datetime import datetime, timezone
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
BASE='677e6ce'

def git(*args):
    return subprocess.check_output(['git','-c','core.quotepath=false',*args],cwd=ROOT).decode('utf-8').strip()

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    target=ROOT/'evidence/engineering/DEV-032-material-verification-2026-10-16.json'
    if target.exists(): raise FileExistsError('Preserve prior report')
    technical=(HERE/'技术文档-v1.md').read_text(encoding='utf-8')
    script=(HERE/'视频脚本-v1.md').read_text(encoding='utf-8')
    pdf_path=ROOT/'output/pdf/DEV-032/宇宙工作台-技术文档-v1.pdf'
    reader=PdfReader(pdf_path)
    extracted='\n'.join(page.extract_text() for page in reader.pages)
    checks=[]
    def check(name,passed,detail=None):
        checks.append({'name':name,'passed':bool(passed),'detail':detail})
    check('pdf_page_limit',len(reader.pages)==13 and len(reader.pages)<=30,len(reader.pages))
    check('pdf_no_replacement_characters','\ufffd' not in extracted)
    headings=re.findall(r'^# (.+)$',technical,re.M)
    check('all_section_titles_extract',all(re.sub(r'\s','',h) in re.sub(r'\s','',extracted) for h in headings),len(headings))
    embedded=[]
    for page in reader.pages:
        for font in page['/Resources']['/Font'].get_object().values():
            obj=font.get_object(); desc=obj.get('/FontDescriptor')
            if desc and ('CJK' in str(obj) or 'Microsoft' in str(obj)):
                embedded.append('/FontFile2' in desc.get_object())
    check('chinese_fonts_embedded',bool(embedded) and all(embedded),len(embedded))
    check('source_and_render_hash_match',json.loads((ROOT/'.local/dev032/render-v1/render-report.json').read_text(encoding='utf-8'))['sourceSha256']==digest(HERE/'技术文档-v1.md'))
    durations=[]
    for m in re.finditer(r'^## (\d+)｜(\d\d):(\d\d)-(\d\d):(\d\d)｜([^\n]+)\n(.*?)(?=^## |\Z)',script,re.M|re.S):
        n,sm,ss,em,es,title,body=m.groups(); start=int(sm)*60+int(ss); end=int(em)*60+int(es)
        voice=re.search(r'\*\*讲解词\*\*\s*(.*?)\n\s*\*\*画面与动作',body,re.S).group(1).strip()
        chars=len(re.sub(r'\s','',voice))
        durations.append({'segment':int(n),'title':title,'startSeconds':start,'endSeconds':end,'durationSeconds':end-start,'narrationCharacters':chars,'charactersPerMinuteIncludingPunctuation':round(chars/(end-start)*60,1)})
    check('continuous_video_timeline',len(durations)==12 and durations[0]['startSeconds']==0 and all(a['endSeconds']==b['startSeconds'] for a,b in zip(durations,durations[1:])) and durations[-1]['endSeconds']==440,durations)
    dev_seconds=sum(x['durationSeconds'] for x in durations if 5<=x['segment']<=8)
    check('development_process_at_least_two_minutes',dev_seconds>=120,dev_seconds)
    check('narration_pacing_plausible',all(x['charactersPerMinuteIncludingPunctuation']<=300 for x in durations),'Character-based planning only; no spoken duration or finished video measured')
    source_paths=[
        'evidence/prompt-chains/README.md','evidence/prompt-chains/manifest.json','evidence/prompt-chains/git-index.json','evidence/prompt-chains/verification-2026-10-16.json',
        'evidence/prompt-chains/01-可视化搭建平台.md','evidence/prompt-chains/02-AI业务闭环.md','evidence/prompt-chains/03-自定义方块与小程序.md',
        'delivery/DEV-031/README.md','delivery/DEV-031/template/README.md','evidence/provenance/yuzhou-0.15.0-import.json','docs/参赛提交核查-2026-10-16.md',
        'evidence/engineering/DEV-031-clean-node22-tests-2026-10-16T13-04-23-562Z.tap','evidence/engineering/DEV-031-reproduction-2026-10-16T13-06-17-100246Z.json','evidence/engineering/DEV-031-final-package-report.json',
        'evidence/engineering/DEV-013-builder-preview.png','evidence/engineering/DEV-020-responsive-review.png','evidence/engineering/DEV-020-browser-metrics.json',
        'evidence/engineering/DEV-027-board-undo-first-failure-2026-10-15.tap','evidence/engineering/DEV-027-board-undo-targeted-2026-10-15.tap',
        'evidence/engineering/DEV-027-tests-2026-10-15T12-26-41-538Z.tap','evidence/engineering/DEV-028-tests-2026-10-15T13-57-04-322Z.tap',
    ]
    source_paths += ['evidence/prompt-chains/raw/chain-'+n+'.md' for n in ['01','02','03']]
    source_paths += ['evidence/prompt-chains/diffs/'+n+'.patch' for n in ['154e54e','964a7c3','02dad36','c67496d','f35b87f','282a536']]
    source_paths += ['evidence/dev/DEV-'+n+'.md' for n in ['004','005','006','009','013','017','018','020','021','024','025','027','028','031']]
    source_paths += ['evidence/engineering/DEV-027-final-'+n+'.png' for n in ['initial-review','revised-review','executed','calendar','undone']]
    source_paths += ['evidence/engineering/DEV-028-miniapp-'+n+'.png' for n in ['first-live-error','calculated','enhanced']]
    source_paths += ['yuzhou/backend/'+n for n in ['server.mjs','store.mjs','hermes.mjs','deepseek.mjs','workspace-queries.mjs','extractor.mjs','extract.py']]
    source_paths += ['yuzhou/frontend/src/'+n for n in ['builder.js','canvas.js','workbench-model.js','workspace-actions.js','miniapp-runtime.js','miniapp-frame.js']]
    missing=[x for x in source_paths if not (ROOT/x).is_file()]
    check('all_indexed_sources_exist',not missing,missing)
    anchors={'01':[2413,3331,6019,6043,9494],'02':[13020,13764,13969],'03':[14715]}
    for chain,nums in anchors.items():
        raw=(ROOT/f'evidence/prompt-chains/raw/chain-{chain}.md').read_text(encoding='utf-8')
        check('raw_chain_'+chain+'_anchors',all(f'id="L{n}"' in raw for n in nums),nums)
    commits=['ac73158','a96689c79bc3','677e6ce','68c569d','e34b7af','5ebe9da','27dd733','154e54e','964a7c3','6fe0529','9b88757','02dad36','efe9436','c67496d','86c03fe','f35b87f','282a536']
    commit_objects={x:git('rev-parse',x+'^{commit}') for x in commits}
    check('referenced_commits_exist',len(commit_objects)==len(commits),commit_objects)
    check('baseline_commit_count',git('rev-list','--count',BASE)=='134',git('rev-list','--count',BASE))
    expected_taps={'DEV-027-tests-2026-10-15T12-26-41-538Z.tap':(785,784,0,1),'DEV-028-tests-2026-10-15T13-57-04-322Z.tap':(810,809,0,1),'DEV-031-clean-node22-tests-2026-10-16T13-04-23-562Z.tap':(811,810,0,1)}
    for filename,expected in expected_taps.items():
        tap=(ROOT/'evidence/engineering'/filename).read_text(encoding='utf-8')
        actual=tuple(int(re.search(r'^# '+k+r' (\d+)$',tap,re.M).group(1)) for k in ['tests','pass','fail','skipped'])
        check(filename+'_statistics',actual==expected,actual)
    timing=json.loads((ROOT/'evidence/engineering/DEV-031-reproduction-2026-10-16T13-06-17-100246Z.json').read_text(encoding='utf-8'))
    check('reproduction_timing',timing['coreElapsedSeconds']==7.514 and timing['steps'][-1]['elapsedSeconds']==28.638 and timing['modelRequests']==0,{'core':timing['coreElapsedSeconds'],'optionalCumulative':timing['steps'][-1]['elapsedSeconds']})
    check('model_usage_supported','203328' in (ROOT/'evidence/dev/DEV-027.md').read_text(encoding='utf-8') and '116584' in (ROOT/'evidence/dev/DEV-028.md').read_text(encoding='utf-8'))
    changes=git('diff','--name-status',BASE,'--').splitlines()
    check('previous_tracked_files_unchanged',all(x.startswith('A\t') for x in changes),changes)
    for f in [HERE/'技术文档-v1.md',HERE/'视频脚本-v1.md']:
        raw=f.read_text(encoding='utf-8')
        check(f.name+'_no_known_secret_pattern',not re.search(r'\bsk-[A-Za-z0-9]{16,}',raw))
    check('pdf_no_known_secret_pattern',not re.search(r'\bsk-[A-Za-z0-9]{16,}',extracted))
    # Evidence hashes make subsequent source changes visible; no source content is rewritten.
    manifest=[{'path':x,'sha256':digest(ROOT/x)} for x in sorted(set(source_paths)) if (ROOT/x).is_file()]
    artifacts=[{'path':str(p.relative_to(ROOT)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':digest(p)} for p in [HERE/'技术文档-v1.md',HERE/'视频脚本-v1.md',pdf_path]]
    result={'createdAtUtc':datetime.now(timezone.utc).isoformat(),'status':'passed' if all(c['passed'] for c in checks) else 'failed','baseline':git('rev-parse',BASE),'checks':checks,'evidenceFiles':manifest,'artifacts':artifacts,'visualReview':{'method':'Agent inspected all 13 rendered pages at 1.4 scale','pages':list(range(1,14)),'result':'No clipped text, overlapping tables, missing glyphs or page spills observed; historical figures retain captions and provenance'},'limits':['No new application tests or model requests in this documentation task','No completed video; timeline and narration are a production plan','Pattern scan of new text is not a full Git history security audit']}
    target.parent.mkdir(parents=True,exist_ok=True)
    with target.open('x',encoding='utf-8') as f: json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps({'status':result['status'],'checks':len(checks),'evidenceFiles':len(manifest),'narrationCharacters':sum(x['narrationCharacters'] for x in durations),'maxCharactersPerMinute':max(x['charactersPerMinuteIncludingPunctuation'] for x in durations),'failed':[x['name'] for x in checks if not x['passed']]},ensure_ascii=False))
    if result['status']!='passed': raise SystemExit(1)

if __name__=='__main__': main()
