from pathlib import Path
import subprocess, json, hashlib, shutil, zipfile, re

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode('utf-8', 'replace')
def write(path, text):
    path=ROOT/path
    if path.exists(): raise FileExistsError(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

IDENTITY='“宇宙”是同一项目的早期名称，后更名为“创宇宙”并持续迭代。'
identity='''# 创宇宙 · 项目名称与开发连续性说明

## 当前统一说明

“宇宙”是同一项目的早期名称，后更名为“创宇宙”并持续迭代。作者先从自己的日常使用需求出发，通过 AI 辅助开发工作台，随后持续实现可组合模块、可视化搭建、空间画布和 AI 审核执行等能力。

“宇宙”与“创宇宙”不作为两个独立项目描述；作品介绍表的“若项目是在其他项目基础上优化”一项填写“不适用”。除本次 GitHub 公开外，本项目此前没有其他公开发表或比赛获奖。以上名称关系与发表获奖情况由作者确认。

## 如何理解旧记录

- “从宇宙复制”“导入 0.15.0”“独立比赛副本”“原项目只读”等历史措辞，描述同一项目不同阶段的目录、版本及运行环境隔离，不表示从另一个项目取得作品，也不改变真实文件来源。
- 旧说明中“基于作者既有宇宙”“自有项目演化”“既有个人项目复用”等用语容易造成两个项目的误解，当前以本说明及 v2 提交材料为准。旧成品保留为历史版本，不再作为本次推荐提交版本。
- “拾光”等更早的界面名称、内部 yuzhou 标识和仍继续维护的个人使用版本均属于开发记录；不能仅凭名称或目录不同推断为不同作品。

## Git 与证据边界

原始提交、SHA、日期、需求原文、失败记录和测试结果保持原样，以本次新增更正提交说明当前表述。25 个早期源码快照使用 2026-10-19 的实际补录时间，是留存版本的补充记录，不是当时的原始 Git 提交，也不伪接为主线祖先。

同一项目的名称连续性，与赛事如何评价早期快照补录，是两个需要分别判断的事项。本次更正不声称已取得组委会对补录方式的认可，也不把补录改写为原始开发记录。

参见 [早期开发说明 v2](创宇宙-早期开发与Git补录说明-v2.md)、[真实开发对话链](../evidence/prompt-chains/README.md)。
'''
write(Path('docs/创宇宙-项目名称与开发连续性说明-v1.md'),identity)

# Audit all reachable commit messages and every unique changed blob in textual documentation.
pattern=r'其他项目基础|基于作者既有|自有项目演化|先前.*宇宙.*演化|复用边界|既有个人项目|宇宙.*复制|原项目只读'
rx=re.compile(pattern)
messages=git('log','--all','--format=%H%x09%s').splitlines()
objects=git('rev-list','--objects','--all').splitlines()
candidates={}
for line in objects:
    parts=line.split(' ',1)
    if len(parts)==2 and Path(parts[1]).suffix.lower() in {'.md','.txt','.json','.mjs','.py'}:
        candidates.setdefault(parts[0],parts[1])
proc=subprocess.Popen(['git','cat-file','--batch'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
hits=[]; scanned=0
for oid,path in candidates.items():
    proc.stdin.write((oid+'\n').encode()); proc.stdin.flush()
    fields=proc.stdout.readline().split()
    if len(fields)!=3: raise RuntimeError(fields)
    size=int(fields[2]); data=proc.stdout.read(size); proc.stdout.read(1)
    if fields[1]!=b'blob': continue
    scanned+=1
    if size>5_000_000: continue
    content=data.decode('utf-8','replace')
    rows=[{'line':i,'text':s[:600]} for i,s in enumerate(content.splitlines(),1) if rx.search(s)]
    if rows: hits.append({'blob':oid,'examplePath':path,'matches':rows})
proc.stdin.close(); proc.wait()
write(Path('.local/dev051/history-wording-audit.json'),json.dumps({'headBefore':git('rev-parse','HEAD').strip(),'textBlobsInspected':scanned,'pattern':pattern,'historicalBlobMatches':hits,'messageMatches':[x for x in messages if rx.search(x)],'handling':'Append correction; preserve original commit objects and evidence. Frozen artifacts superseded by v2.'},ensure_ascii=False,indent=2))

old=ROOT/'docs/创宇宙-早期开发与Git补录说明-v1.md'
text=old.read_text(encoding='utf-8')
text=text.replace('# 创宇宙：从个人版“宇宙”到比赛作品的开发来源说明','# 创宇宙：同一项目的早期开发与 Git 补录说明 v2')
text=text.replace('“创宇宙”由作者先前自用的“宇宙”演化而来。','“宇宙”是同一项目的早期名称，后更名为“创宇宙”并持续迭代。早期以个人日常使用为目标，后持续实现可组合工作台；目录复制表示开发与运行环境隔离。')
text=text.replace('参赛表述建议：**“作品由本人先前开发的个人工作台‘宇宙’演化而来；早期以对话和发布包留存，参赛阶段保留真实 Git 提交，另对留存早期源码进行了明确标注的快照补录。”**','参赛表述：**“宇宙”是同一项目的早期名称，后更名为“创宇宙”并持续迭代。早期以对话和发布包留存，后续保留真实 Git 提交，另对留存早期源码进行了明确标注的快照补录。**')
text=text.replace('GitHub 上传保持暂停，未提交比赛、未发给组委会、未重新运行旧部署或调用模型。','GitHub 仓库已公开；本次仅修正文档与交付说明，未提交比赛、未发给组委会、未重新运行旧部署或调用模型。')
text=text.replace('本次新建来源说明、证据文件、脚本与补录分支，没有覆盖旧成品。','早期来源追溯创建了说明、证据文件、脚本与补录分支。本 v2 更正项目名称关系，旧成品保留。')
write(Path('docs/创宇宙-早期开发与Git补录说明-v2.md'),text)

for rel in ['docs/创宇宙-早期开发与Git补录说明-v1.md','docs/创宇宙-官方规则与历史补录核查-v1.md','docs/参赛提交核查-2026-10-16.md']:
    path=ROOT/rel; current=path.read_text(encoding='utf-8'); pos=current.find('\n')
    banner='\n\n> 当前更正：'+IDENTITY+'下文是当时的核查记录；其中将同一项目不同阶段称为“既有项目复用”的表述不再沿用。名称与当前提交入口见[连续性说明]('+('创宇宙-项目名称与开发连续性说明-v1.md')+')。历史快照补录的性质及核查限制仍保留。\n'
    path.write_text(current[:pos]+banner+current[pos:],encoding='utf-8')

src=ROOT/'submission/创宇宙-v1'; dst=ROOT/'submission/创宇宙-v2'
if dst.exists(): raise FileExistsError(dst)
shutil.copytree(src,dst)
(dst/'.gitattributes').unlink() # Git-only helper, absent from the original release manifest.
readme=(dst/'README.md').read_text(encoding='utf-8')
readme=readme.replace('正式提交版 v1','正式提交版 v2')
readme=readme.replace('项目基于作者既有“宇宙”0.15.0，在独立比赛副本中持续开发。本次新增贡献与复用边界见 `SOURCE-NOTICE.md`。内部`yuzhou`目录、包名、数据库及备份标识保留兼容；当前产品展示名统一为“创宇宙”，历史来源名称不改写。',IDENTITY+'0.15.0 是同一项目早期版本，比赛目录的物理复制用于隔离开发与运行环境。完整说明见 `SOURCE-NOTICE.md`。内部 `yuzhou` 目录、包名、数据库及备份标识保留兼容。')
(dst/'README.md').write_text(readme,encoding='utf-8')
notice='''# 创宇宙 · 项目连续性与交付说明

“宇宙”是同一项目的早期名称，后更名为“创宇宙”并持续迭代。0.15.0 为同一项目的早期版本；当时将150个源码与必要资源文件复制到比赛目录，用于隔离开发、运行数据和测试，不表示作品来自另一个项目。

原始目录导入提交为 ac73158；本批次应用源码基线为 9c567d7d3c3a069fe681723f1aa9cbc350407d0f。后续持续完成可组合工作台、可视化拖入搭建、主子空间画布、导航编排、AI查询与审核执行闭环、自定义方块与受控小程序、课表关联、账单分类及存储迁移。真实对话、阶段测试与Git历史记录这些变化。

本 v2 只更正项目名称关系与交付说明，应用代码与 v1 保持一致。当前品牌统一为“创宇宙”，内部兼容标识和历史文件名保留。RELEASE-CHANGES.json 记录文档更正；SOURCE-MANIFEST.json 提供逐文件校验。早期25个源码快照是2026-10-19实际创建的补录记录，不冒充当时原始Git。

除本次 GitHub 公开外，本项目此前没有其他公开发表或比赛获奖。“若项目是在其他项目基础上优化”一项不适用。

作者账号、业务数据、初始化口令、API Key、数据库、附件、浏览器资料、签名文件、.git和迁移数据不在本包。公开仓库未新增开源许可证；第三方许可遵循相应发行物。Git完整记录与三条开发Prompt链见公开仓库，ZIP用于复现，不替代Git历史。本说明不声称组委会已认可事后快照补录。
'''
(dst/'SOURCE-NOTICE.md').write_text(notice,encoding='utf-8')
changes=json.loads((dst/'RELEASE-CHANGES.json').read_text(encoding='utf-8'))
changes['release']='2026-10-19-submit-v2'
changes['documentationCorrection']={'statement':IDENTITY,'previousRelease':'v1','applicationCodeChanged':False,'files':['README.md','SOURCE-NOTICE.md'],'gitHistoryRewritten':False}
for row in changes['changes']:
    if row['path'] in {'README.md','SOURCE-NOTICE.md'}:
        p=dst/row['path']; row['bytes']=p.stat().st_size;row['sha256']=sha(p)
        row['reasons'].append('clarify same-project rename and continuous development')
(dst/'RELEASE-CHANGES.json').write_text(json.dumps(changes,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
manifest=json.loads((dst/'SOURCE-MANIFEST.json').read_text(encoding='utf-8'))
manifest['release']='2026-10-19-submit-v2'
for row in manifest['files']:
    p=dst/row['path']; row['bytes']=p.stat().st_size; row['sha256']=sha(p)
(dst/'SOURCE-MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
formal=ROOT/'delivery/2026-10-19_创宇宙正式提交_v2'; formal.mkdir(exist_ok=False)
with zipfile.ZipFile(formal/'创宇宙_源码_正式提交版_v2.zip','x',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(dst.rglob('*')):
        if p.is_file(): z.write(p,p.relative_to(dst).as_posix())
shutil.copy2(dst/'README.md',formal/'README.md')
net=ROOT/'delivery/2026-10-19_创宇宙网盘提交_v2';net.mkdir(exist_ok=False)
shutil.copy2(formal/'创宇宙_源码_正式提交版_v2.zip',net/'创宇宙_源码_正式提交版_v2.zip')
shutil.copy2(dst/'README.md',net/'README.md')
shutil.copy2(ROOT/'delivery/2026-10-19_创宇宙网盘提交_v1/“创宇宙”正式提交视频.mp4',net/'“创宇宙”正式提交视频.mp4')
oldzip=ROOT/'delivery/2026-10-19_创宇宙网盘提交_v1/创宇宙_AI开发过程证据_提交附件_v1.zip'
with zipfile.ZipFile(oldzip) as before, zipfile.ZipFile(net/'创宇宙_AI开发过程证据_提交附件_v2.zip','x',zipfile.ZIP_DEFLATED) as after:
    for item in before.infolist(): after.writestr(item,before.read(item.filename))
    after.writestr('当前阅读说明.txt',(IDENTITY+'\n旧证据中的目录复制、原项目等指文件隔离；旧说明按当前项目连续性说明理解。原始对话和提交不修改。\n').encode('utf-8'))
    after.write(ROOT/'docs/创宇宙-项目名称与开发连续性说明-v1.md','docs/创宇宙-项目名称与开发连续性说明-v1.md')
    after.write(ROOT/'docs/创宇宙-早期开发与Git补录说明-v2.md','docs/创宇宙-早期开发与Git补录说明-v2.md')
links='''创宇宙 · 最终提交链接 v2

项目说明：“宇宙”是同一项目的早期名称，后更名为“创宇宙”并持续迭代。

GitHub仓库：https://github.com/guojianyu0806/chuangyuzhou
最新复现指南：https://github.com/guojianyu0806/chuangyuzhou/blob/main/submission/创宇宙-v2/README.md
Git主线：https://github.com/guojianyu0806/chuangyuzhou/commits/main
三条AI开发对话链：https://github.com/guojianyu0806/chuangyuzhou/tree/main/evidence/prompt-chains
项目名称说明：https://github.com/guojianyu0806/chuangyuzhou/blob/main/docs/创宇宙-项目名称与开发连续性说明-v1.md
早期快照：https://github.com/guojianyu0806/chuangyuzhou/tree/codex/yuzhou-historical-snapshots

早期快照是明确标注的事后补录；原始Git提交及SHA保留。除本次GitHub公开外，本项目此前没有其他公开发表或比赛获奖。
'''
write(net.relative_to(ROOT)/'作品链接.txt',links)
write(Path('.local/dev051/preserved-v1.json'),json.dumps({str(p.relative_to(ROOT)):sha(p) for folder in ['delivery/2026-10-19_创宇宙正式提交_v1','delivery/2026-10-19_创宇宙网盘提交_v1'] for p in (ROOT/folder).rglob('*') if p.is_file()},ensure_ascii=False,indent=2))
write(Path('.local/dev051/history-before.json'),json.dumps({'main':git('rev-list','main').splitlines(),'snapshots':git('rev-list','codex/yuzhou-historical-snapshots').splitlines()},indent=2))
print(json.dumps({'scannedTextBlobs':scanned,'matchingHistoricalBlobs':len(hits),'sourceFiles':len(manifest['files']),'formal':str(formal),'netdisk':str(net)},ensure_ascii=False))
