from pathlib import Path
import importlib.util, html, json, hashlib
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, KeepTogether
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image as PILImage, ImageOps, ImageDraw

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'delivery/2026-10-19_创宇宙网盘提交_v2/创宇宙_作品介绍文档_正式提交版_v1.pdf'
RENDER=ROOT/'.local/dev051/pdf-preview'
if OUT.exists() or RENDER.exists(): raise FileExistsError('Preserve old output')
RENDER.mkdir(parents=True)
pdfmetrics.registerFont(TTFont('CJK','C:/Windows/Fonts/msyh.ttc',subfontIndex=0))
pdfmetrics.registerFont(TTFont('CJK-Bold','C:/Windows/Fonts/msyhbd.ttc',subfontIndex=0))
spec=importlib.util.spec_from_file_location('old_renderer',ROOT/'delivery/DEV-045/build_pdf.py')
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
INK=colors.HexColor('#25243C');PURPLE=colors.HexColor('#7650D7');MUTED=colors.HexColor('#69657D');PALE=colors.HexColor('#F4F1FB');LINE=colors.HexColor('#E1DCEC')
WIDTH=A4[0]-96
styles={
 'tag':ParagraphStyle('tag',fontName='CJK-Bold',fontSize=9,leading=14,textColor=PURPLE,spaceAfter=13),
 'title':ParagraphStyle('title',fontName='CJK-Bold',fontSize=27,leading=36,textColor=INK,spaceAfter=12,wordWrap='CJK'),
 'h1':ParagraphStyle('h1',fontName='CJK-Bold',fontSize=20,leading=29,textColor=INK,spaceAfter=16,wordWrap='CJK'),
 'h2':ParagraphStyle('h2',fontName='CJK-Bold',fontSize=12,leading=20,textColor=PURPLE,spaceBefore=11,spaceAfter=7,wordWrap='CJK'),
 'body':ParagraphStyle('body',fontName='CJK',fontSize=10.3,leading=18,textColor=INK,spaceAfter=9,wordWrap='CJK'),
 'small':ParagraphStyle('small',fontName='CJK',fontSize=8.5,leading=14,textColor=MUTED,spaceAfter=7,wordWrap='CJK'),
 'table':ParagraphStyle('table',fontName='CJK',fontSize=9.3,leading=16,textColor=INK,wordWrap='CJK'),
 'code':ParagraphStyle('code',fontName='CJK',fontSize=9,leading=18,textColor=PURPLE,backColor=PALE,borderPadding=10,spaceBefore=7,spaceAfter=14,wordWrap='CJK')}
story=[];source=[]
def p(text,style='body'):
    story.append(Paragraph(text,styles[style]));source.append(text)
def h(text):p(text,'h2')
def page(tag,title):
    if story:story.append(PageBreak())
    p(tag,'tag');p(title,'h1')
def table(rows,widths):
    cells=[[Paragraph(html.escape(x),styles['table']) for x in row] for row in rows]
    t=Table(cells,colWidths=[WIDTH*x for x in widths],hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),PALE),('VALIGN',(0,0),(-1,-1),'TOP'),('BOX',(0,0),(-1,-1),.5,LINE),('INNERGRID',(0,0),(-1,-1),.35,LINE),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
    story.append(t);story.append(Spacer(1,10));source.extend([' | '.join(row) for row in rows])
def shot(path):
    full=ROOT/path
    with PILImage.open(full) as im:w,h=im.size
    story.append(Image(str(full),width=WIDTH,height=WIDTH*h/w));story.append(Spacer(1,9))
    source.append('图片：'+path)
def link(label,url):p('<link href="'+html.escape(url,quote=True)+'" color="#7650D7">'+html.escape(label)+'</link>','small')

p('传智杯 AI 创新应用挑战赛  /  作品介绍文档','tag')
p('创宇宙','title')
p('让每个人搭建自己的工作台','h1')
p('用模块、空间和方块组织自己的资料、日程与任务，让 AI 伙伴参与查询、方案修订和经确认的执行。')
story.append(old.Diagram('overview',WIDTH))
h('1. 项目详情')
p('创宇宙是一款可组合的个人工作台。学习、活动筹备和日常生活中的信息常散落在笔记、任务清单、课表和账本中。用户可以按照自己的习惯，选择需要的模块，把它们放在自由画布上，再用空间组织一个课程、一项活动或一段计划。')
p('产品以自主搭建、日常使用和 AI 协作为主线：搭建台负责选择与摆放，业务页面承载资料和记录，AI 伙伴在读取支持范围内的信息后提出可审核的行动方案。用户可以从空白工作台开始，也可以选择模板后调整。')
h('适用场景')
p('例如，为读书分享会建立筹备空间，把活动资料、准备任务和日程放在一起；为课程关联课表与学习笔记；用灵感墙收集零散想法；按收支分类查看校园生活账本。模块可选，不要求每个人使用相同的布局。')
p('“宇宙”是同一项目的早期名称，后更名为“创宇宙”并持续迭代。','small')
p('正式介绍版 v1 · 2026-10-19 · 配套源码正式提交版 v2','small')

page('要求 1 / 使用方式','从启动到搭建自己的工作台')
h('运行准备')
p('安装 Node.js 22.13 或更高版本，将配套源码 ZIP 解压到新的普通可写目录。基础网页应用无需 npm install，也无需前端构建。本批次实际验证环境为 Windows、Node.js 22.23.3。')
p('在解压后的包根目录打开终端，依次运行：')
p('node tools/verify-source.mjs<br/>node tools/start.mjs --check<br/>node tools/start.mjs','code')
p('也可双击“启动创宇宙.cmd”。启动后保持终端运行，默认在本机浏览器访问 http://127.0.0.1:4399/。从 GitHub 下载整个仓库时，先进入 submission/创宇宙-v2 目录。')
table([['步骤','操作与预期结果'],['01 建立账号','首次页面输入本副本初始化口令；口令位于 yuzhou/.cu-runtime/data/setup-code.txt。自选账号与至少12字符的密码。'],['02 搭建布局','进入搭建台选择模块或模板，拖入方块并调整大小；可设置侧栏顺序，以及主空间、子空间各自的画布。'],['03 保存日常内容','打开模块或空间添加笔记、任务等内容，等待保存成功，刷新确认记录保留。'],['04 体验 AI 协作','在“偏好与连接”配置自己的模型 Key；提出需求，查看查询与审核单，按需修订，再确认执行。'],['05 重启复核','按 Ctrl+C 停止服务，再用同一入口启动并登录，检查保存内容。运行数据保存在当前解压副本内。']],[.21,.79])
h('可选配置')
p('AI 功能需要自己的模型账号、网络和额度。DOCX/PPTX 正文解析可选 Python 3.10 以上；文字 PDF 另需按 README 配置 pypdf。扫描图片 OCR、旧 DOC/PPT 不在当前支持范围内。基础运行不要求模型 Key。','small')

page('要求 2 / 项目亮点','让组织方式随人变化')
table([['亮点','具体实现与使用价值'],['工作台可以自己搭','通过模块库、模板和自由画布配置工作台。拖入、移动和调整尺寸都有实际页面与数据承载。'],['空间承载一件完整的事','主空间和子空间分别保存画布；笔记、任务与日历等内容可围绕课程、活动或项目组织。'],['AI 行动可以先看再做','将查询、方案、修订与确认分开；用户看到要改什么，再选择执行。执行后提供回执，并支持限定范围内的撤销。'],['从模块延伸到小工具','除预置模块外，用户可创建配置型方块或代码型小程序。小程序先审核保存，再手动运行。'],['灵感既能收集，也能浏览','用独立灵感墙与持续流动的梦境视图展示旧记录；动效只影响浏览，不自动生成用户经历。'],['关注长期使用中的细节','提供课程与课表关联、账单分类、自定义类别、草稿恢复与存储迁移保护，减少重复整理。']],[.27,.73])
h('一条连续使用路径')
p('用户先建立“周末读书分享会”空间，放入笔记和任务模块；再请 AI 读取已有筹备资料，提出待办和日程方案；发现日期不合适时继续修订，审核后确认落地。活动推进时，用户仍可直接在页面编辑原有内容。')
h('以实际能力呈现亮点')
p('本作品的价值体现在可组合的界面和可检查的执行流程。目前未开展独立真人对照试验，因此不宣称节省了某个比例的时间，也不将单例成功扩大为所有 AI 请求的成功率。','small')

page('要求 3 / AI 测试技术落地使用情况概述','AI 参与开发，也参与工作台协作')
h('AI 辅助开发的实际使用')
p('作者以自然语言描述需求，通过 Codex 进行 Vibe Coding，持续讨论约束、修改代码、排查问题并运行回归检查。公开材料保留三条核心功能的开发对话链：可视化搭建、AI 业务闭环、自定义方块与小程序。所选主题含104条公开文本、46条历史提交索引和10份关键 diff；范围说明与缺失附件单独列明。')
h('产品中的 AI 落地路径')
story.append(old.Diagram('workflow',WIDTH))
p('AI 伙伴使用结构化协议读取支持的工作区信息，提出行动方案。应用对响应格式、允许的行动、对象归属及状态进行校验；用户可跨轮修订，确认前不写业务数据。代码型小程序保存后，仍需用户手动启动。')
h('已执行的测试与复核')
table([['验证层次','实际结果与证据'],['自动回归','最近一批全量检查共862项：861通过、0失败、1可选跳过。它们是工程检查，不是AI成功率。'],['真实模型场景','DEV-027验证查询、修订、审核、执行、刷新与撤销；DEV-028验证小程序生成、审核、手动运行与后续更新。均保留初次失败及重试。'],['交付复现','正式包已在独立解压目录完成初始化、保存、停止、重启与登录。v2只改说明，另通过296文件校验和启动预检。']],[.23,.77])
p('真实模型验证使用 DeepSeek V4 Pro 的合成场景。测试依据包括断言、状态比对、刷新与撤销结果及浏览器观察；AI 输出本身不作为通过标准。本次文档整理未新增模型调用。','small')

page('要求 4 / 关键技术','轻量运行，按层约束数据与行动')
story.append(old.Diagram('architecture',WIDTH))
story.append(Spacer(1,12))
table([['技术部分','实现方式'],['前端与交互','原生 JavaScript 模块、HTML/CSS；模块化页面、自由画布、拖入搭建与独立空间配置。'],['服务与存储','Node.js HTTP 服务、SQLite；账号会话、CSRF 防护、状态版本检查与事务保存。客户端使用账号隔离的 IndexedDB 处理缓存与草稿。'],['模型与行动协议','模型适配、结构化响应解析、行动白名单、对象与容器检查；确认执行、结果回执与有限撤销。'],['自定义扩展','配置型方块和代码型小程序分层；受控运行环境及限定接口，小程序由用户手动启动。'],['文档与复现','Node/Python 文本提取；独立运行目录、初始化入口、逐文件 SHA-256 清单及启动预检。']],[.25,.75])
p('源码包不含作者账号、业务数据库、初始化口令或模型密钥。当前交付为本机网页复现，尚未完成公网部署验收、全设备兼容或外部安全审计。','small')

page('要求 5 / 项目相关图片 ①','可视化搭建台')
shot('evidence/engineering/DEV-013-builder-preview.png')
p('图1：DEV-013 合成环境中的搭建台。截图属于历史开发阶段，展示方块库与画布同屏、直接拖入及双击访问的界面。','small')
h('图中能力')
p('用户在同一界面选择模块和摆放位置，之后可移动、调整尺寸或打开对应页面。这里的画布与实际工作台共享布局数据，而不是独立的演示摆拍。')
h('持续迭代')
p('后续阶段在这条能力上继续增加导航编排、主子空间独立画布、空间选择入口与多种页面适配。截图用于说明实现过程，不代表当前版本每处视觉细节。')
link('对应开发记录：evidence/dev/DEV-013.md','https://github.com/guojianyu0806/chuangyuzhou/blob/main/evidence/dev/DEV-013.md')

page('要求 5 / 项目相关图片 ②','先审核，再确认执行')
shot('evidence/engineering/DEV-027-final-revised-review.png')
p('图2：DEV-027 合成环境中的 AI 审核页面。方案已按跨轮要求修改截止日期，页面仍处于“待你审核·尚未执行”状态。','small')
h('图中能力')
p('AI 在读取支持范围内的信息后提出行动目标，用户可以继续补充或修订。方案与实际写入之间保留明确的确认步骤，避免把一段回复直接当作已完成的操作。')
h('结果如何核验')
p('对应开发阶段还检查了确认后的空间、笔记与任务关联、刷新保留以及撤销后的状态。本图展示执行前状态，不能单凭截图证明后续全部操作成功；后续结果由对应开发记录和测试证据支撑。')
link('对应开发记录：evidence/dev/DEV-027.md','https://github.com/guojianyu0806/chuangyuzhou/blob/main/evidence/dev/DEV-027.md')

page('要求 5 / 项目相关图片 ③','让自定义方块具备交互能力')
shot('evidence/engineering/DEV-028-miniapp-calculated.png')
p('图3：DEV-028 合成环境中修订后的小程序运行结果。预算150、单价25、数量4，计算支出100、余额50。','small')
h('图中能力')
p('用户可以描述需要的小工具，由 AI 形成方案并审核修订，保存后手动运行。小程序通过限定的接口处理输入、计算和保存，不自动取得系统命令或其他项目的数据权限。')
h('真实开发过程')
p('该案例最初出现过运行失败，之后修复并完成输入校验、计算、保存刷新、功能更新与撤销检查。提交材料保留失败与修复过程，展示需求如何经过多轮对话成为可运行的功能。')
link('对应开发记录：evidence/dev/DEV-028.md','https://github.com/guojianyu0806/chuangyuzhou/blob/main/evidence/dev/DEV-028.md')

page('要求 6、7 / 发表获奖及项目关系说明','同一项目，持续迭代')
h('6. 项目之前是否发表过或获奖')
p('<b>除本次 GitHub 公开外，本项目此前没有其他公开发表或比赛获奖。</b>')
h('7. 若项目是在其他项目基础上优化')
p('<b>不适用。“宇宙”是同一项目的早期名称，后更名为“创宇宙”并持续迭代。</b>')
p('项目从作者的日常使用需求起步，持续发展为可由用户选择模块、组织空间并与 AI 协作的工作台。早期版本复制到比赛目录，是为了隔离源码、运行数据和测试环境；这是同一项目的开发安排。')
h('开发记录与版本关系')
p('保留真实 Git 提交、作者时间和原有 SHA。早期未找回完整原始 Git 的阶段，以留存对话、代码补丁和发布包补充说明；25个源码快照于2026-10-19按实际日期补录，明确标注为补充版本记录。')
p('公开记录中的“原项目”“导入”“复制”等历史词语，按目录和版本隔离理解。当前介绍以同一项目的名称关系为准；原始对话、阶段失败和真实修改记录继续保留。')
h('提交与复核入口')
link('GitHub公开仓库：guojianyu0806/chuangyuzhou','https://github.com/guojianyu0806/chuangyuzhou')
link('正式源码与完整运行指南：submission/创宇宙-v2/README.md','https://github.com/guojianyu0806/chuangyuzhou/blob/main/submission/创宇宙-v2/README.md')
link('三条核心AI开发对话链：evidence/prompt-chains/README.md','https://github.com/guojianyu0806/chuangyuzhou/blob/main/evidence/prompt-chains/README.md')
link('完整主线提交记录','https://github.com/guojianyu0806/chuangyuzhou/commits/main')
p('本文对应提交表第6项“作品介绍文档”。配套源码、视频、README与AI过程附件一并放入网盘作品目录，第5项填写该目录的长期有效分享链接及提取码。','small')

def footer(canvas,doc):
    canvas.saveState(); w,h=A4
    canvas.setStrokeColor(LINE);canvas.line(48,43,w-48,43)
    canvas.setFont('CJK',8);canvas.setFillColor(MUTED)
    canvas.drawString(48,29,'创宇宙 · 作品介绍文档')
    canvas.drawRightString(w-48,29,f'{doc.page} / 9')
    canvas.restoreState()
doc=SimpleDocTemplate(str(OUT),pagesize=A4,rightMargin=48,leftMargin=48,topMargin=45,bottomMargin=57,title='创宇宙 · 作品介绍文档',author='创宇宙项目作者')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
reader=PdfReader(OUT)
if len(reader.pages)!=9:raise RuntimeError(f'Unexpected pages: {len(reader.pages)}')
texts=[pg.extract_text() for pg in reader.pages]
whole='\n'.join(texts)
required=['项目详情','使用方式','项目亮点','AI 测试技术落地使用情况概述','关键技术','项目相关图片','发表过或获奖','不适用','“宇宙”是同一项目的早期名称']
for text in required:
    if text not in whole:raise AssertionError(text)
document=pdfium.PdfDocument(str(OUT));thumbs=[]
for i in range(len(document)):
    im=document[i].render(scale=1.65).to_pil().convert('RGB');im.save(RENDER/f'page-{i+1:02}.png')
    th=im.copy();th.thumbnail((298,422));tile=PILImage.new('RGB',(318,452),'#e9e7ef');tile.paste(th,((318-th.width)//2,10));ImageDraw.Draw(tile).text((14,433),str(i+1),fill='black');thumbs.append(tile)
contact=PILImage.new('RGB',(318*3,452*3),'white')
for i,im in enumerate(thumbs):contact.paste(im,((i%3)*318,(i//3)*452))
contact.save(RENDER/'contact.png')
(ROOT/'delivery/DEV-051/作品介绍文档-正文-v1.txt').write_text('\n\n'.join(source),encoding='utf-8')
result={'pdf':str(OUT.relative_to(ROOT)),'pages':len(reader.pages),'pageTextLengths':[len(t) for t in texts],'sha256':hashlib.sha256(OUT.read_bytes()).hexdigest(),'requiredTextChecks':required,'renderDirectory':str(RENDER.relative_to(ROOT))}
(RENDER/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
