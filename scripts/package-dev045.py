"""Create a reviewable submission copy; never alter existing source or artifacts."""
from pathlib import Path
import hashlib, json, subprocess, re, zipfile, argparse

ROOT = Path(__file__).resolve().parent.parent
BASE = '9c567d7d3c3a069fe681723f1aa9cbc350407d0f'
WORK = ROOT / '.local/dev045/package'
FINAL = ROOT / 'delivery/2026-10-19_创宇宙正式提交_v1'
EXTRAS = {'scripts/test-yuzhou.mjs', 'scripts/configure-yuzhou-extractor.mjs', 'evidence/provenance/yuzhou-0.15.0-import.json'}
TEMPLATE = 'delivery/DEV-031/template/'

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def sha(b): return hashlib.sha256(b).hexdigest()

def new(path, data):
    if not path.absolute().is_relative_to(ROOT) or path.resolve()!=path.absolute(): raise ValueError('Unsafe destination')
    for p in [path,*path.parents]:
        if p.exists() and (p.is_symlink() or p.is_junction()): raise ValueError('Linked destination')
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('xb') as f: f.write(data)

def encoded(s): return s.encode('utf8')
def jsonbytes(v): return encoded(json.dumps(v,ensure_ascii=False,indent=2)+'\n')

def prepare():
    if WORK.exists() or FINAL.exists(): raise FileExistsError('Submission/work directory already exists')
    if git('diff','--name-only',BASE,'--','yuzhou').strip(): raise ValueError('Source changed; choose explicit new baseline')
    files, records, changes = {}, [], []
    for raw in git('ls-tree','-r','-z',BASE).split(b'\0'):
        if not raw: continue
        meta,p=raw.split(b'\t',1); mode,kind,oid=meta.decode().split(); source=p.decode()
        if not(source.startswith('yuzhou/') or source.startswith(TEMPLATE) or source in EXTRAS): continue
        if mode not in ('100644','100755') or kind!='blob': raise ValueError('Special file rejected')
        target=source[len(TEMPLATE):] if source.startswith(TEMPLATE) else source
        old=git('cat-file','blob',oid); data=old; reasons=[]
        if target=='README.md':
            data=(ROOT/'delivery/DEV-045/README-template.md').read_bytes(); reasons.append('new reviewer-facing README')
        elif target=='SOURCE-NOTICE.md':
            data=encoded('''# 创宇宙 · 来源与交付说明

本作品基于作者既有“宇宙”0.15.0的150个公开源码及必要资源文件，在独立比赛副本中持续开发。原始导入提交ac73158；本批次应用基线9c567d7d3c3a069fe681723f1aa9cbc350407d0f。来源清单的机器路径已用说明文字替代，文件相对路径和原始哈希保留。

比赛新增内容包括可组合工作台、可视化拖入搭建、主子空间画布、导航编排、交互体验、AI查询与审核执行闭环、自定义方块与受控小程序、课表关联、账单分类、存储迁移及复现交付。具体演进由原始Prompt和真实Git历史支撑，不将150文件基线导入伪装为比赛期间逐行新写。

包内当前品牌统一为“创宇宙”；内部路径、兼容标识和基线版本0.15.0不改。名称、文档、机器信息清理和历史脚本禁用等转换逐项见RELEASE-CHANGES.json；没有修改活动开发目录。原始Git对象哈希和最终文件哈希均在SOURCE-MANIFEST.json中。

作者账号、业务、初始化口令、API Key、数据库、附件、浏览器资料、签名文件、.git和迁移数据包均不在本包。未附新的开源许可证，不凭空授予历史代码及第三方依赖许可；Node、Python、pypdf的许可由其官方发行物承载。本包供赛事评审复现，非已完成公开开源发布。

既有个人项目继续开发是否符合赛事“从0到1”口径，仍须组委会确认。源码ZIP不替代评审可访问的GitHub/Gitee仓库和至少三条完整开发Prompt链。历史“宇宙”名称、原始失败及人的实际分工保持如实披露。
'''); reasons.append('current provenance and scope notice')
        elif target=='启动工作台.cmd':
            target='启动创宇宙.cmd'; reasons.append('rename release launcher')
        elif target=='evidence/provenance/yuzhou-0.15.0-import.json':
            obj=json.loads(old);obj['sourceRoot']='[REDACTED_LOCAL_PATH: author original workbench]';obj['targetRoot']='yuzhou';obj['submissionNote']='Only machine-specific roots redacted; original relative file list and SHA-256 preserved.'
            data=jsonbytes(obj); reasons.append('redact machine roots; preserve provenance hashes')
        elif target.startswith('yuzhou/') and target.endswith('README.md'):
            relative='../'*(len(Path(target).parts)-1)+'README.md'
            section=Path(target).parent.name
            data=encoded(f'# 创宇宙 · {section}\n\n本目录属于创宇宙正式提交版。请从[包根目录README]({relative})完成首次启动和配置。\n\n')
            if section in ('mobile','deployment'):
                data+=encoded('这里保留历史工程源码，安卓构建与部署入口已禁用，不能用来访问作者服务器或发布本作品。本批次仅验证本地网页应用，不提供安卓成品或公网部署承诺。历史机器地址和签名路径已移除，来源见包根目录SOURCE-NOTICE.md。\n')
            else:
                data+=encoded('基础应用在包根目录通过`node tools/start.mjs`运行。默认127.0.0.1:4399，使用本副本自己的数据。后端负责鉴权、存储、模型及解析，前端负责页面、画布与审核。完整过程证据另由赛事仓库提供。旧阶段运行说明保留在原仓库历史中，不作为当前复现步骤。\n')
            reasons.append('replace stale machine-specific instructions in submission copy')
        elif target.startswith('yuzhou/frontend/tests/') and target.endswith('.mjs') and not target.endswith('.test.mjs'):
            s=old.decode();s=re.sub(r"C:/Users/[^']+/node_modules/playwright",'playwright',s)
            data=encoded("// Historical browser script: review only; use documented isolated tests.\nthrow new Error('SUBMISSION_LEGACY_BROWSER_DISABLED: configure an isolated browser test explicitly before reuse.');\n"+s)
            reasons.append('disable legacy browser execution; remove machine dependency paths')
        else:
            try: s=old.decode('utf8')
            except UnicodeDecodeError: s=None
            if s is not None:
                if target=='yuzhou/backend/tests/extractor.test.mjs':
                    s,n=re.subn(r"const python = \[[\s\S]*?\]\.find\(existsSync\);", "const python = [join(RUNTIME_ROOT, 'extractor-venv', 'Scripts', 'python.exe'), join(RUNTIME_ROOT, 'extractor-venv', 'bin', 'python')].find(existsSync);", s, count=1)
                    if n!=1: raise ValueError('Extractor test pattern changed')
                    reasons.append('discover only this package optional Python environment')
                if target in ['yuzhou/frontend/index.html','yuzhou/frontend/manifest.webmanifest','yuzhou/frontend/src/ai-chat.js','yuzhou/frontend/src/app.js','yuzhou/frontend/src/cloud.js','yuzhou/frontend/src/welcome.js','yuzhou/frontend/src/workbench-model.js','yuzhou/backend/hermes.mjs','yuzhou/frontend/package.json','yuzhou/mobile/android/app/src/main/res/values/strings.xml']:
                    s=s.replace('宇宙','创宇宙').replace('传智杯创宇宙','创宇宙').replace('创宇宙 · 传智杯独立副本','创宇宙')
                    s=s.replace('基于创宇宙 v','基于原宇宙 v').replace('原创宇宙的全部内置模块','既有全部内置模块')
                    s=s.replace('启动创宇宙完整副本.cmd','启动创宇宙.cmd').replace('建立你的私人创宇宙','建立你的工作台')
                    s=s.replace('创宇宙 · 基于 v','创宇宙 · 基于宇宙 v')
                    reasons.append('current product display name; preserve internal identifiers')
                if target.startswith('yuzhou/deployment/') and '203.195.191.239' in s:
                    s=s.replace('203.195.191.239','example.invalid');reasons.append('redact historical server address; disabled guard unchanged')
                data=encoded(s)
        files[target]=data
        rec={'path':target,'sourcePath':source,'gitBlob':oid,'sourceSha256':sha(old),'bytes':len(data),'sha256':sha(data)}
        records.append(rec)
        if data!=old or target!=source and reasons:
            changes.append({**rec,'reasons':reasons})
    files['RELEASE-CHANGES.json']=jsonbytes({'sourceCommit':BASE,'changes':changes,'activeSourceModified':False})
    records.append({'path':'RELEASE-CHANGES.json','sourcePath':'generated','bytes':len(files['RELEASE-CHANGES.json']),'sha256':sha(files['RELEASE-CHANGES.json'])})
    manifest={'schemaVersion':1,'product':'创宇宙','release':'2026-10-19-submit-v1','sourceCommit':BASE,'sourceBaseVersion':'0.15.0','defaultPort':4399,'privateRuntimeIncluded':False,'files':sorted(records,key=lambda x:x['path'])}
    files['SOURCE-MANIFEST.json']=jsonbytes(manifest)
    secret=re.compile(rb'sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')
    findings=[]
    for p,data in files.items():
        if secret.search(data): findings.append({'path':p,'type':'credential-pattern','value':'withheld'})
        if re.search(rb'C:[/\\]Users[/\\]g2806|203\.195\.191\.239',data):findings.append({'path':p,'type':'machine-private-reference','value':'withheld'})
        if re.search(r'(^|/)(\.git|\.cu-runtime|node_modules|\.env)(/|$)|\.(db|sqlite|p12|keystore|jks)$',p,re.I):findings.append({'path':p,'type':'forbidden-path'})
    if findings: raise ValueError(json.dumps(findings,ensure_ascii=False))
    for p,data in files.items(): new(WORK/p,data)
    new(FINAL/'README.md',files['README.md'])
    new(ROOT/'evidence/engineering/DEV-045-package-preparation.json',jsonbytes({'sourceCommit':BASE,'payloadFiles':len(files),'transformations':len(changes),'credentialPatternMatches':0,'machineReferenceMatches':0,'scope':'Selected committed source and release files only; not all Git history','changes':changes}))
    print(json.dumps({'prepared':str(WORK),'files':len(files),'changes':len(changes)},ensure_ascii=False))

def archive():
    manifest=json.loads((WORK/'SOURCE-MANIFEST.json').read_text('utf8'))
    paths=[r['path'] for r in manifest['files']]+['SOURCE-MANIFEST.json']
    for r in manifest['files']:
        data=(WORK/r['path']).read_bytes()
        if sha(data)!=r['sha256'] or len(data)!=r['bytes']:raise ValueError('Package changed: '+r['path'])
    out=FINAL/'创宇宙_源码_正式提交版_v1.zip'
    with zipfile.ZipFile(out,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in sorted(paths):
            entry=zipfile.ZipInfo(p,date_time=(2026,10,19,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;entry.external_attr=0o100644<<16
            z.writestr(entry,(WORK/p).read_bytes())
    with zipfile.ZipFile(out) as z:
        assert z.testzip() is None and len(z.namelist())==len(set(paths))
        for p in paths: assert z.read(p)==(WORK/p).read_bytes()
    report={'archive':out.relative_to(ROOT).as_posix(),'bytes':out.stat().st_size,'sha256':sha(out.read_bytes()),'files':len(paths),'sourceCommit':BASE,'zipRoundtrip':True}
    new(ROOT/'evidence/engineering/DEV-045-package-final.json',jsonbytes(report));print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['prepare','archive']);args=parser.parse_args()
    prepare() if args.action=='prepare' else archive()
