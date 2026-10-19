"""Create new reading guides and v3 evidence attachment; retain all prior outputs."""
from pathlib import Path
import datetime,hashlib,json,shutil,zipfile,subprocess
ROOT=Path(__file__).resolve().parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(rel,value):
    p=ROOT/rel;p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('x',encoding='utf-8',newline='\n') as f:f.write(value if isinstance(value,str) else json.dumps(value,ensure_ascii=False,indent=2)+'\n')
old=ROOT/'docs/创宇宙-早期开发与Git补录说明-v2.md'
content=old.read_text(encoding='utf-8')
content=content.replace('Git 补录说明 v2','Git 补录说明 v3').replace('整理日期：2026-10-19。','更新日期：2026-10-20。')
content=content.replace('因此，现在建立独立分支','此前建立独立分支')
intro='''## 0.1.0：从需求、建文件到本地启动

本次在已有初始材料上，补充0.1.0原始开发、启动及次日修复记录。所有原始时间统一给出UTC及北京时间；本次整理和Git提交使用实际当前时间。

| 环节 | 北京时间 | 原始证据与实际含义 |
| --- | --- | --- |
| 从需求出发 | 2026-09-19 23:07 | [用户原文L9](../evidence/provenance/DEV-052/messages/L00009.txt)：从自己的学习和日常使用需求提出工作台 |
| 规划与启动开发 | 23:15、23:38 | [规格补丁L133](../evidence/provenance/DEV-052/patches/L00133.patch.txt)、[用户要求L419](../evidence/provenance/DEV-052/messages/L00419.txt)：先完成界面 |
| 首批程序文件 | 23:44—23:58 | [初始建文件记录](../evidence/provenance/DEV-052/README.md)：页面、图标、服务层、app.js与app.css；版本字段为0.1.0 |
| 启动输出 | 23:59:50 | [L562调用/L565输出](../evidence/provenance/DEV-052/runtime/L00562.json)：`Workbench 0.1.0 (local UI)`，地址为当时的本机4173端口；采集时进程仍在运行 |
| 实现后的检查 | 2026-09-20 00:09—00:11 | [主要流程](../evidence/provenance/DEV-052/runtime/L00786.json)、[存储回归](../evidence/provenance/DEV-052/runtime/L00806.json)：保存当时断言输出与返回码，本轮未重新执行旧程序 |
| 实际使用反馈 | 10:08 | [用户原文L834](../evidence/provenance/DEV-052/messages/L00834.txt)：127地址无法访问，请求修复 |
| 失败与调整 | 10:09—10:11 | [补丁匹配失败](../evidence/provenance/DEV-052/runtime/L00847.json)、[脚本未找到](../evidence/provenance/DEV-052/runtime/L00890.json)：保留真实中间失败 |
| 启动方式修复 | 10:12—10:13 | [launch.mjs补丁](../evidence/provenance/DEV-052/patches/L00904.patch.txt)、[启动结果](../evidence/provenance/DEV-052/runtime/L00904.json)、[HTTP200及复用](../evidence/provenance/DEV-052/runtime/L00914.json)、[启动文件复查](../evidence/provenance/DEV-052/runtime/L00933.json) |
| 形成下一轮需求 | 当日修复后 | [卡片画布与空间](../evidence/provenance/DEV-052/messages/L00948.txt)、[动态侧栏](../evidence/provenance/DEV-052/messages/L00960.txt)、[AI入口](../evidence/provenance/DEV-052/messages/L00970.txt)、[自建工作区](../evidence/provenance/DEV-052/messages/L00985.txt)、[确认继续](../evidence/provenance/DEV-052/messages/L00995.txt) |

新增材料包含17份原始补丁、9条用户需求和11组运行/错误/验证记录，逐项索引见[DEV-052清单](../evidence/provenance/DEV-052/manifest.json)。其中6份补丁与DEV-047已公开原件字节相同；新增内容与旧材料分别保存。

这些记录补充了0.2.0之前的开发起点和真实反馈闭环。没有据此拼出一个声称完整可运行的0.1.0源码包：主对话补丁未完整覆盖课程、英语等依赖模块；也未恢复当时原始Git。0.1.0是本地界面阶段，启动成功不等于当时已完成真实模型和云同步。

## 从起点到当前作品的完整阅读路径

| 阶段 | 阅读入口 | 记录形式 |
| --- | --- | --- |
| 初始需求与0.1.0 | [DEV-052](../evidence/provenance/DEV-052/README.md) | 原始需求、代码补丁、启动、验证与修复记录 |
| 0.2.0至0.15.0 | [25个留存版本](../evidence/provenance/DEV-047/README.md) | 留存发布源码按实际日期补录的Git快照，保留逐版差异 |
| 同一项目进入隔离比赛目录 | [0.15.0导入清单](../evidence/provenance/yuzhou-0.15.0-import.json)、原提交ac73158 | 当时真实Git提交及逐文件来源比对 |
| 工作台平台化与功能迭代 | [DEV阶段记录](../evidence/dev/)、[三条AI开发链](../evidence/prompt-chains/README.md) | 真实需求、原始提交、关键diff与测试证据 |
| 模型业务与小程序闭环 | [DEV-027](../evidence/dev/DEV-027.md)、[DEV-028](../evidence/dev/DEV-028.md) | 查询、审核、执行、刷新、撤销，及小程序手动运行；失败与重试保留 |
| 后续日常使用与交付 | [DEV-034](../evidence/dev/DEV-034.md)、[DEV-037](../evidence/dev/DEV-037.md)、[DEV-044](../evidence/dev/DEV-044.md)、[正式包](../submission/创宇宙-v2/README.md) | 存储保护、课程关联、分类录入与独立目录复现 |
| 名称统一与公开提交材料 | [同一项目说明](创宇宙-项目名称与开发连续性说明-v1.md)、[GitHub发布回执](创宇宙-GitHub发布回执-v1.md) | “宇宙”更名为“创宇宙”持续迭代，原SHA与旧成品保留 |

“完整阅读路径”指把现存不同形式的证据串接起来，便于评审从起点追踪到当前作品；不表示找回了每次编辑或全部原始附件。

'''
content=content.replace('## 可追溯的开发时间线',intro+'## 可追溯的开发时间线')
content=content.replace('| 2026-09-20 | 留存个人版 0.2.0 起的发布包', '| 2026-09-19 23:59—09-20 10:13 | 0.1.0首次本地启动、功能/存储验证、访问失败反馈与启动器修复 | [DEV-052原始证据](../evidence/provenance/DEV-052/README.md) |\n| 2026-09-20 | 留存个人版 0.2.0 起的发布包')
content=content.replace('## 证据与复核入口','## 证据与复核入口\n\n- [0.1.0开发、启动与修复记录](../evidence/provenance/DEV-052/README.md)及[逐项清单](../evidence/provenance/DEV-052/manifest.json)：本次新增，不覆盖原有记录。')
content=content.replace('本 v2 更正项目名称关系，旧成品保留。','v2更正项目名称关系；本v3新增0.1.0开发与启动证据，旧文档及成品保留。')
save(Path('docs/创宇宙-早期开发与Git补录说明-v3.md'),content)
root=ROOT/'README.md';readme=root.read_text(encoding='utf-8')
readme=readme.replace('docs/创宇宙-早期开发与Git补录说明-v2.md','docs/创宇宙-早期开发与Git补录说明-v3.md')
readme=readme.replace('- **比赛真实主线 `main`**','- [从最初需求到0.1.0启动与修复](evidence/provenance/DEV-052/README.md)：17份原始补丁、9条需求及11组历史运行/验证记录，含失败尝试；与后续版本及真实Git串接阅读。\n- **比赛真实主线 `main`**')
root.write_text(readme,encoding='utf-8',newline='\n')

# New attachment carries original v2 contents plus a versioned addendum.
delivery=ROOT/'delivery/2026-10-20_创宇宙开发过程补充_v1';delivery.mkdir(exist_ok=False)
attachment=delivery/'创宇宙_AI开发过程证据_提交附件_v3.zip'
previous=ROOT/'delivery/2026-10-19_创宇宙网盘提交_v2/创宇宙_AI开发过程证据_提交附件_v2.zip'
with zipfile.ZipFile(previous) as original,zipfile.ZipFile(attachment,'x',zipfile.ZIP_DEFLATED) as result:
    for item in original.infolist():result.writestr(item,original.read(item.filename))
    for p in sorted((ROOT/'evidence/provenance/DEV-052').rglob('*')):
        if p.is_file():result.write(p,p.relative_to(ROOT).as_posix())
    result.write(ROOT/'docs/创宇宙-早期开发与Git补录说明-v3.md','docs/创宇宙-早期开发与Git补录说明-v3.md')
    result.writestr('阅读入口-v3.txt','创宇宙开发过程证据v3：从 docs/创宇宙-早期开发与Git补录说明-v3.md 开始阅读。\n本次新增 evidence/provenance/DEV-052 的0.1.0需求、补丁、启动、验证和修复记录。旧版记录原样保留；早期快照为明确标注的补录。\n“宇宙”是同一项目的早期名称，后更名为“创宇宙”并持续迭代。\n'.encode('utf-8'))
save(delivery.relative_to(ROOT)/'补充说明.txt','''创宇宙 · 开发过程补充

新增0.1.0开发与启动记录，补齐从需求、首次本地界面到修复和后续迭代的阅读路径。
本目录v3证据ZIP包含此前v2证据内容和本次新记录；不覆盖旧附件。源码正式版v2、作品介绍PDF、README及视频未改。
网盘请使用 2026-10-20_创宇宙网盘提交_v3 文件夹，其中开发证据附件已升级为v3，其他主要文件与上一版一致。
GitHub入口：https://github.com/guojianyu0806/chuangyuzhou
过程入口：https://github.com/guojianyu0806/chuangyuzhou/blob/main/docs/创宇宙-早期开发与Git补录说明-v3.md
''')
net=ROOT/'delivery/2026-10-20_创宇宙网盘提交_v3';net.mkdir(exist_ok=False)
for name in ['README.md','“创宇宙”正式提交视频.mp4','创宇宙_源码_正式提交版_v2.zip','创宇宙_作品介绍文档_正式提交版_v1.pdf']:
    shutil.copy2(previous.parent/name,net/name)
shutil.copy2(attachment,net/attachment.name)
links=(previous.parent/'作品链接.txt').read_text(encoding='utf-8')
links=links.replace('最终提交链接 v2','最终提交链接 v3')
links+='\n完整开发过程阅读入口（含0.1.0）：https://github.com/guojianyu0806/chuangyuzhou/blob/main/docs/创宇宙-早期开发与Git补录说明-v3.md\n0.1.0原始证据：https://github.com/guojianyu0806/chuangyuzhou/tree/main/evidence/provenance/DEV-052\n'
save(net.relative_to(ROOT)/'作品链接.txt',links)
for directory in [delivery,net]:
    sums='\n'.join(f'{sha(p)}  {p.name}' for p in sorted(directory.iterdir()) if p.is_file())+'\n'
    save(directory.relative_to(ROOT)/'SHA256SUMS.txt',sums)
save(Path('evidence/dev/DEV-052.md'),'''# DEV-052 · 补充0.1.0开发与启动记录

用户要求把0.1.0的开发和启动记录补进项目从0到1的过程，同步GitHub并保留旧文件。

只读原始会话前995行，按明确范围摘编17份原始补丁、9条用户需求和11组运行/错误/验证记录。包含首次Workbench0.1.0启动、历史功能/存储检查、访问失败反馈、PowerShell修复尝试失败、Node启动器修复及HTTP200和重复启动复用结果。记录真实调用及结果行号、时间、原始行和文件SHA-256；未执行历史代码。

旧DEV-047六份补丁与新对应原文逐字节一致。第一次提取因一条工具调用含两份补丁而中止，未覆盖旧材料；不完整提取保留在忽略的.local/dev052/extraction-draft，修正解析后重新生成完整新证据。

新增早期开发说明v3，保留v1/v2，根README更新入口且先另存原文。新增v3开发证据附件和网盘目录；源码、PDF、视频等复制文件保持原字节。原有提交、25条快照补录、原始会话和用户其他改动保留，不伪造完整0.1.0源码或倒填Git日期。

校验为原文/文件哈希、链接、旧文件保持、公开内容扫描、附件成员和Git可达性检查；不重新运行旧程序、不访问正式账号、不请求模型、不修改个人工作台、不上传网盘或提交比赛。GitHub同步及访问结果以核验回执为准。
''')
print(json.dumps({'attachment':str(attachment),'attachmentSha256':sha(attachment),'netdisk':str(net),'files':[p.name for p in net.iterdir()]},ensure_ascii=False))
