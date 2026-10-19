from pathlib import Path
import json, hashlib, zipfile, shutil, subprocess
ROOT=Path(__file__).resolve().parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def new(p,text):
    p=ROOT/p
    if p.exists():raise FileExistsError(p)
    p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf-8')
src=ROOT/'submission/创宇宙-v2'
readme=(src/'README.md').read_text(encoding='utf-8')
readme=readme.replace('`SOURCE-NOTICE.md`：既有项目来源、比赛新增工作和公开边界。','`SOURCE-NOTICE.md`：同一项目的名称关系、持续迭代与交付边界。')
readme=readme.replace('仓库尚未上传时，不把本地路径当作可访问仓库链接。','公开仓库：https://github.com/guojianyu0806/chuangyuzhou 。')
readme=readme.replace('项目含既有作者源码复用，来源如实披露，不承诺赛事资格已经获得组委会确认。','“宇宙”与“创宇宙”为同一项目；早期快照补录的性质明确标注，不把工程核查作为赛事资格认可。')
(src/'README.md').write_text(readme,encoding='utf-8')
changes=json.loads((src/'RELEASE-CHANGES.json').read_text(encoding='utf-8'))
for row in changes['changes']:
    if row['path']=='README.md':row['bytes']=(src/'README.md').stat().st_size;row['sha256']=sha(src/'README.md')
(src/'RELEASE-CHANGES.json').write_text(json.dumps(changes,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
manifest=json.loads((src/'SOURCE-MANIFEST.json').read_text(encoding='utf-8'))
for row in manifest['files']:
    p=src/row['path'];row['bytes']=p.stat().st_size;row['sha256']=sha(p)
(src/'SOURCE-MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
# Preserve the internal packaging draft, then create final archives with updated descriptions.
formal=ROOT/'delivery/2026-10-19_创宇宙正式提交_v2';net=ROOT/'delivery/2026-10-19_创宇宙网盘提交_v2'
for idx,folder in enumerate([formal,net]):
    p=folder/'创宇宙_源码_正式提交版_v2.zip'
    shutil.move(str(p),str(ROOT/f'.local/dev051/source-v2-draft-{idx}.zip'))
    with zipfile.ZipFile(p,'x',zipfile.ZIP_DEFLATED) as z:
        for file in sorted(src.rglob('*')):
            if file.is_file():z.write(file,file.relative_to(src).as_posix())
    # README v2 is an undelivered draft so keep it before replacing final bytes.
    shutil.move(str(folder/'README.md'),str(ROOT/f'.local/dev051/README-v2-draft-{idx}.md'))
    shutil.copy2(src/'README.md',folder/'README.md')

pdf=net/'创宇宙_作品介绍文档_正式提交版_v1.pdf'
assert pdf.exists()
shutil.copy2(pdf,formal/pdf.name)
for folder in [formal,net]:
    rows=[f'{sha(p)}  {p.name}' for p in sorted(folder.iterdir()) if p.is_file()]
    new(folder.relative_to(ROOT)/'SHA256SUMS.txt','\n'.join(rows)+'\n')
audit=json.loads((ROOT/'.local/dev051/history-wording-audit.json').read_text(encoding='utf-8'))
before=json.loads((ROOT/'.local/dev051/preserved-v1.json').read_text(encoding='utf-8'))
assert all(sha(ROOT/p)==digest for p,digest in before.items())
changed=[]
for p in src.rglob('*'):
    if p.is_file() and sha(p)!=sha(ROOT/'submission/创宇宙-v1'/p.relative_to(src)):
        changed.append(p.relative_to(src).as_posix())
assert sorted(changed)==['README.md','RELEASE-CHANGES.json','SOURCE-MANIFEST.json','SOURCE-NOTICE.md']
report={
 'headBefore':audit['headBefore'],'reachableTextBlobsInspected':audit['textBlobsInspected'],
 'historicalBlobsMatchingBroadPattern':len(audit['historicalBlobMatches']),
 'scanScope':'All refs reachable before this correction; unique UTF-8-decoded md, txt, json, mjs, py blobs and commit subjects; broad wording search, not a security scan.',
 'findings':['Current README and package notice could imply two projects.','Earlier narrative reports used own-project reuse wording.','Historical import and isolation commits describe real file operations and are compatible with the same-project explanation.'],
 'correction':'Same-project rename and continuous development; append current explanation and supersede frozen v1 delivery with v2.',
 'sourceFilesVerified':296,'applicationCodeChanges':False,'packageChangedFiles':changed,
 'oldArtifactsUnchanged':before,'pdfPages':9,'gitHistoryRewritten':False,'earlySnapshotsRetrospective':True,
 'notPerformed':['Contest submission','Netdisk upload','New model requests']}
new(Path('evidence/engineering/DEV-051-identity-and-delivery-verification.json'),json.dumps(report,ensure_ascii=False,indent=2)+'\n')
new(Path('docs/创宇宙-名称表述与Git核查-v1.md'),'''# 创宇宙 · 名称表述与 Git 核查

当前统一说明：“宇宙”是同一项目的早期名称，后更名为“创宇宙”并持续迭代。

## 核查范围与发现

核查更正前全部本地分支可达的1078个去重文本文件版本及提交标题。宽泛关键词命中155个历史文件版本；其中包含同一说明的多个修订、真实目录隔离记录和原始证据，不等于155处错误。完整逐行扫描记录仅用于本地复核，不公开重复原始文本。

当前首页、v1正式包README与来源说明使用“基于既有宇宙”“复用”等容易引起两个项目误解的表述；早期来源说明及部分核查材料也沿用了相似措辞。已经更新首页、新建统一名称说明与早期说明v2，并在历史说明页首标明当前更正。真实需求、代码导入、目录复制、测试失败和快照补录性质保留。

## 本次变更

- 原始提交、SHA、日期和25条补录分支提交不改写，以新增提交完成更正。
- 最新运行入口改为 `submission/创宇宙-v2`；包内只修改README、SOURCE-NOTICE、变更清单及哈希清单，应用代码与v1逐文件一致。
- 新建9页作品介绍文档，逐项覆盖表单七项要求。第7项不适用；“宇宙”为早期名称，并非其他项目。
- 除本次GitHub公开外，本项目此前没有其他公开发表或比赛获奖。
- 旧PDF、ZIP、视频及v1网盘目录逐文件哈希未变化。v2源码296文件校验、启动预检通过。

## 当前提交材料

网盘请使用 `delivery/2026-10-19_创宇宙网盘提交_v2` 整个目录。旧技术PDF中的来源措辞属于已保留的历史版本；当前推荐上传新作品介绍文档，不再将旧PDF列为本次主文档。

表单第5项填写网盘长期有效分享链接和提取码；第6项上传新作品介绍PDF。Git链接填写仓库主页，AI开发记录链接见Prompt链入口。网盘上传和比赛表单提交均由用户完成。

[项目连续性说明](创宇宙-项目名称与开发连续性说明-v1.md) · [早期开发说明v2](创宇宙-早期开发与Git补录说明-v2.md) · [核查摘要](../evidence/engineering/DEV-051-identity-and-delivery-verification.json)
''')
root=ROOT/'README.md';text=root.read_text(encoding='utf-8')
text=text.replace('submission/创宇宙-v1','submission/创宇宙-v2')
text=text.replace('delivery/2026-10-19_创宇宙正式提交_v1/创宇宙_源码_正式提交版_v1.zip','delivery/2026-10-19_创宇宙正式提交_v2/创宇宙_源码_正式提交版_v2.zip')
text=text.replace('[技术文档 PDF](delivery/2026-10-19_创宇宙正式提交_v1/创宇宙_技术文档_正式提交版_v1.pdf)','[作品介绍 PDF（含技术说明）](delivery/2026-10-19_创宇宙正式提交_v2/创宇宙_作品介绍文档_正式提交版_v1.pdf)')
text=text.replace('- [提交前核查报告](delivery/2026-10-19_创宇宙正式提交_v1/提交前核查报告.md) · [文件校验和](delivery/2026-10-19_创宇宙正式提交_v1/SHA256SUMS.txt)','- [名称表述与 Git 核查](docs/创宇宙-名称表述与Git核查-v1.md) · [最新文件校验和](delivery/2026-10-19_创宇宙正式提交_v2/SHA256SUMS.txt)')
text=text.replace('本作品由作者通过 AI 辅助开发。最初是个人使用的“宇宙”工作台，2026-10-08 将 0.15.0 底座物理复制到独立比赛目录，继续演化为可供每个人搭建的“创宇宙”。历史名称、基线导入、实际失败与验证限制均保留。','本作品由作者通过 AI 辅助开发。“宇宙”是同一项目的早期名称，后更名为“创宇宙”并持续迭代。2026-10-08 将同一项目的 0.15.0 版本物理复制到独立比赛目录，用于隔离开发、运行数据和测试环境。历史名称、导入操作、实际失败与验证限制均保留。\n\n[项目名称与开发连续性说明](docs/创宇宙-项目名称与开发连续性说明-v1.md)。除本次 GitHub 公开外，本项目此前没有其他公开发表或比赛获奖。作品介绍第7项“若项目是在其他项目基础上优化”不适用。')
text=text.replace('docs/创宇宙-早期开发与Git补录说明-v1.md','docs/创宇宙-早期开发与Git补录说明-v2.md')
text=text.replace('仍未取得组委会对自有项目演化及快照补录的具体书面认可','未取得组委会对早期快照补录方式的具体书面认可')
text=text.replace('| `delivery/2026-10-19_创宇宙正式提交_v1/` | 保留的正式 ZIP、README、PDF 和核查报告 |','| `delivery/2026-10-19_创宇宙正式提交_v2/` | 当前源码 ZIP、README、作品介绍 PDF 与校验和 |\n| `submission/创宇宙-v1/`、`delivery/2026-10-19_创宇宙正式提交_v1/` | 保留的历史交付；说明以 v2 及名称连续性说明为准 |')
root.write_text(text,encoding='utf-8')
new(Path('evidence/dev/DEV-051.md'),'''# DEV-051 · 项目名称连续性更正与正式材料

用户确认“宇宙”是同一项目早期名称，后更名为“创宇宙”持续迭代，并要求核查Git冲突表述并更正；此前确认除本次GitHub公开无其他发表或获奖。

按当前事实更正首页、交付README与来源说明，以v2源码包和新9页作品介绍文档作为最新入口。旧成品及原提交保留，不改写SHA、提交日期或原始对话。历史说明页增加更正提示；目录复制、隔离和实际导入为真实操作记录。

核查1078个可达去重文本版本，宽泛模式命中155个历史文件版本；命中数量不等于错误数量。v2的应用代码与v1逐文件一致，296文件校验及启动预检通过。旧正式/网盘v1文件哈希保持；新PDF渲染9页检查排版、七项内容与声明。未运行重复全量测试、未调用模型、未修改正式运行数据。

新材料位于delivery/2026-10-19_创宇宙正式提交_v2及网盘提交_v2。Git更正使用新增提交并正常推送；是否公开同步成功以随后核验回执为准。本轮不上传网盘、不提交比赛。用户其他改动保持。
''')
print(json.dumps({'v2ChangedFiles':changed,'v1PreservedFiles':len(before),'netdiskFiles':[p.name for p in net.iterdir()]},ensure_ascii=False))
