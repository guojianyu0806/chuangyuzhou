"""Render the editable Markdown as a paginated Chinese technical PDF.

Requires reportlab and Pillow. Fonts are read from Windows, never copied into
the delivery. Intermediate rendering/QA output belongs outside this folder.
"""
from pathlib import Path
from xml.sax.saxutils import escape
import re
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, Image, Flowable, KeepTogether,
)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SOURCE = HERE / '创宇宙_Web赛道技术文档_正文_v5.md'
OUTPUT = HERE / '创宇宙_Web赛道技术文档_v5.pdf'
SOURCE_SHA = '977ff30a5a1300d767b5a4fac11da34cb8fee498'
PAGE_COUNT = SOURCE.read_text(encoding='utf-8').count('<!-- PAGE -->') + 1
INK = colors.HexColor('#172C39')
MUTED = colors.HexColor('#52636D')
TEAL = colors.HexColor('#087D78')
PURPLE = colors.HexColor('#6B46B1')
PALE = colors.HexColor('#EFF6F5')
RULE = colors.HexColor('#D5E2E3')
WIDTH, HEIGHT = A4
CONTENT = WIDTH - 96


def register_fonts():
    font_dir = Path('C:/Windows/Fonts')
    for name, filename in [('Body', 'Deng.ttf'), ('Bold', 'Dengb.ttf')]:
        path = font_dir / filename
        if not path.is_file():
            raise RuntimeError(f'Missing font: {path}')
        pdfmetrics.registerFont(TTFont(name, str(path)))
    pdfmetrics.registerFontFamily('Body', normal='Body', bold='Bold', italic='Body', boldItalic='Bold')


def styles():
    common = dict(fontName='Body', textColor=INK, wordWrap='CJK', allowWidows=0, allowOrphans=0)
    return {
        'body': ParagraphStyle('BodyText', fontSize=10.1, leading=17, spaceAfter=8, **common),
        'h1': ParagraphStyle('Chapter', fontName='Bold', textColor=INK, fontSize=22, leading=29, spaceAfter=17, wordWrap='CJK'),
        'h2': ParagraphStyle('Subhead', fontName='Bold', textColor=TEAL, fontSize=12.1, leading=18.5, spaceBefore=10, spaceAfter=6, wordWrap='CJK', keepWithNext=True),
        'cover': ParagraphStyle('Cover', fontName='Bold', textColor=INK, fontSize=44, leading=56, spaceAfter=8, wordWrap='CJK'),
        'subtitle': ParagraphStyle('Subtitle', fontName='Bold', textColor=TEAL, fontSize=19, leading=28, spaceAfter=19, wordWrap='CJK'),
        'small': ParagraphStyle('Small', fontSize=8.2, leading=12.5, spaceAfter=6, textColor=MUTED, fontName='Body', wordWrap='CJK'),
        'cell': ParagraphStyle('Cell', fontSize=9.15, leading=14.5, fontName='Body', textColor=INK, wordWrap='CJK'),
        'headcell': ParagraphStyle('HeadCell', fontSize=9.2, leading=14.5, fontName='Bold', textColor=colors.white, wordWrap='CJK'),
        'code': ParagraphStyle('Code', fontName='Body', fontSize=8.3, leading=13.5, textColor=INK, wordWrap='CJK', leftIndent=10, rightIndent=10),
        'note': ParagraphStyle('Note', fontName='Body', fontSize=9.2, leading=15, textColor=MUTED, wordWrap='CJK', spaceBefore=5, spaceAfter=8),
    }


def inline(text):
    text = escape(text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'`([^`]+)`', r'<font color="#6B46B1">\1</font>', text)
    text = re.sub(r'\[([^\]]+)\]\((https?://[^\s)]+)\)', r'<link href="\2" color="#087D78">\1</link>', text)
    return text


class Diagram(Flowable):
    def __init__(self, kind, sty):
        super().__init__()
        self.kind = kind
        self.sty = sty
        self.width = CONTENT
        self.height = {'architecture': 196, 'workflow': 138, 'miniapp': 136, 'sync': 128}[kind]

    def draw(self):
        c = self.canv
        def box(x, y, w, h, title, detail='', fill=PALE):
            c.setFillColor(fill); c.setStrokeColor(RULE)
            c.roundRect(x, y, w, h, 6, fill=1, stroke=1)
            p = Paragraph(inline(title), self.sty['cell'])
            _, ph = p.wrap(w - 18, h)
            p.drawOn(c, x + 9, y + h - ph - 9)
            if detail:
                p = Paragraph(inline(detail), self.sty['small'])
                _, ph = p.wrap(w - 18, h)
                p.drawOn(c, x + 9, y + 8)
        def arrow(x1, y1, x2, y2):
            c.setStrokeColor(TEAL); c.setLineWidth(1.1)
            c.line(x1, y1, x2, y2)
            import math
            a = math.atan2(y2-y1, x2-x1)
            for d in [-0.45, 0.45]:
                c.line(x2, y2, x2-6*math.cos(a+d), y2-6*math.sin(a+d))
        w = CONTENT
        if self.kind == 'architecture':
            box(0, 140, w, 51, '**浏览器：HTML / CSS / JavaScript模块**', '欢迎页、搭建台、业务页面、AI审核、IndexedDB恢复与草稿')
            arrow(w/2, 138, w/2, 119)
            box(0, 65, w, 53, '**同源Node HTTP服务：页面 + /api/**', '认证 / CSRF / 状态版本 / 查询 / 文件 / AI后台任务')
            arrow(w/4, 63, w/4, 47); arrow(3*w/4, 63, 3*w/4, 47)
            box(0, 0, w/2-8, 46, '**SQLite + 原件目录**', '账号、会话、工作区、附件')
            box(w/2+8, 0, w/2-8, 46, '**DeepSeek HTTPS接口**', '仅用户触发AI时发送请求')
        elif self.kind == 'workflow':
            gap = 10; bw = (w-2*gap)/3
            labels = [('用户意图','任务与当前上下文'),('只读查询','返回合法范围记录'),('结构化方案','校验后展示审核单'),('人工修订与审核','确认前不写业务'),('确认执行与保存','版本校验、结果回执'),('刷新与有限撤销','保护后续人工修改')]
            for i,(title,detail) in enumerate(labels):
                row,col=divmod(i,3)
                if row: col=2-col
                x=col*(bw+gap); y=76 if row==0 else 4
                box(x,y,bw,56,'**'+title+'**',detail)
                if row==0 and col<2: arrow(x+bw+1,y+28,x+bw+gap-1,y+28)
                if row==1 and col>0: arrow(x-1,y+28,x-gap+1,y+28)
            arrow(w-12,74,w-12,62)
        elif self.kind == 'miniapp':
            box(0,75,w,56,'**可信主页面**','审核代码、手动运行、渲染受支持组件树、保存所属方块数据')
            arrow(w/2,73,w/2,60)
            box(0,0,w/2-8,58,'**隔离渲染页**','受限消息协议；不接管主页面DOM')
            box(w/2+8,0,w/2-8,58,'**代码执行Worker**','超时终止；通过app接口读写本块数据')
            arrow(w/2-6,29,w/2+6,29)
        else:
            gap=12; bw=(w-2*gap)/3
            for i,(title,detail) in enumerate([('本地编辑','内存状态与待同步缓存'),('版本提交','baseRevision与服务端比对'),('同步回执','新revision与保存状态')]):
                box(i*(bw+gap),64,bw,58,'**'+title+'**',detail)
                if i<2: arrow((i+1)*bw+i*gap+1,93,(i+1)*(bw+gap)-1,93)
            box(0,0,w,49,'**版本不一致时保留恢复副本**','不静默覆盖不同内容；可导出、比较，再决定后续处理')


def table(lines, sty):
    rows=[]
    for line in lines:
        cells=[x.strip() for x in line.strip().strip('|').split('|')]
        if all(re.fullmatch(r':?-+:?', x) for x in cells):
            continue
        rows.append(cells)
    n=len(rows[0])
    ratios={2:[0.25,0.75],3:[0.22,0.40,0.38],4:[0.15,0.29,0.28,0.28]}.get(n,[1/n]*n)
    if rows[0][0]=='环境字段': ratios=[0.42,0.58]
    if rows[0][0]=='编号': ratios=[0.10,0.90]
    data=[[Paragraph(inline(x),sty['headcell'] if i==0 else sty['cell']) for x in row] for i,row in enumerate(rows)]
    t=Table(data,colWidths=[CONTENT*r for r in ratios],hAlign='LEFT',repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,0),TEAL),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,PALE]),
        ('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),
        ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),
        ('LINEBELOW',(0,-1),(-1,-1),0.5,RULE),
    ]))
    return t


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(TEAL); canvas.rect(0,HEIGHT-9,WIDTH,9,fill=1,stroke=0)
    canvas.setFont('Body',8.2); canvas.setFillColor(MUTED)
    canvas.drawString(48,HEIGHT-34,'创宇宙  /  AI WEB网页开发挑战赛')
    canvas.drawRightString(WIDTH-48,HEIGHT-34,'技术文档 v5 · WEB-039')
    canvas.setStrokeColor(RULE); canvas.line(48,45,WIDTH-48,45)
    canvas.setFont('Body',8); canvas.drawString(48,30,f'源码 {SOURCE_SHA[:7]}  |  文档 2026-11-15')
    canvas.drawRightString(WIDTH-48,30,f'{doc.page:02d} / {PAGE_COUNT}')
    canvas.restoreState()


def build():
    register_fonts(); sty=styles(); story=[]
    lines=SOURCE.read_text(encoding='utf-8').splitlines(); i=0; blocks=0
    while i<len(lines):
        line=lines[i].strip()
        if not line: i+=1; continue
        if line=='<!-- PAGE -->': story.append(PageBreak()); i+=1; continue
        if line.startswith('<!--'): i+=1; continue
        if line.startswith('# '):
            title=line[2:]
            story.append(Paragraph(inline(title),sty['cover'] if blocks==0 else sty['h1']))
            blocks+=1; i+=1; continue
        if line.startswith('## '): story.append(Paragraph(inline(line[3:]),sty['h2'])); i+=1; continue
        if line.startswith(':::subtitle '): story.append(Paragraph(inline(line[12:]),sty['subtitle'])); i+=1; continue
        if line.startswith(':::diagram '): story.extend([Diagram(line.split()[1],sty),Spacer(1,10)]); i+=1; continue
        if line.startswith(':::imagecrop '):
            _, rel, coordinates, caption=line.split(' ',3)
            from io import BytesIO
            from PIL import Image as PILImage
            bounds=tuple(map(int,coordinates.split(',')))
            with PILImage.open(ROOT/rel) as original:
                if len(bounds)!=4 or not (0<=bounds[0]<bounds[2]<=original.width and 0<=bounds[1]<bounds[3]<=original.height):
                    raise ValueError('Image crop must stay inside its cited source screenshot.')
                crop=original.crop(bounds); iw,ih=crop.size; buffer=BytesIO(); crop.save(buffer,format='PNG'); buffer.seek(0)
            story.extend([Image(buffer,width=CONTENT,height=CONTENT*ih/iw),Spacer(1,5),Paragraph(inline(caption),sty['small'])]);i+=1;continue
        if line.startswith(':::image '):
            _, rel, caption=line.split(' ',2)
            p=ROOT/rel
            from PIL import Image as PILImage
            with PILImage.open(p) as im: iw,ih=im.size
            story.extend([Image(str(p),width=CONTENT,height=CONTENT*ih/iw),Spacer(1,5),Paragraph(inline(caption),sty['small'])]); i+=1; continue
        if line.startswith('|'):
            group=[]
            while i<len(lines) and lines[i].strip().startswith('|'): group.append(lines[i]); i+=1
            story.extend([table(group,sty),Spacer(1,9)]); continue
        if line.startswith('```'):
            group=[]; i+=1
            while i<len(lines) and not lines[i].startswith('```'): group.append(lines[i]); i+=1
            p=Paragraph('<br/>'.join(escape(x).replace(' ','&#160;') for x in group),sty['code'])
            t=Table([[p]],colWidths=[CONTENT]);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),.5,RULE),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
            story.extend([t,Spacer(1,10)]);i+=1;continue
        if line.startswith('> '): story.append(Paragraph(inline(line[2:]),sty['note'])); i+=1; continue
        group=[line];i+=1
        while i<len(lines) and lines[i].strip() and not re.match(r'^(#|\||:::|```|<!--|> )',lines[i].strip()): group.append(lines[i].strip());i+=1
        story.append(Paragraph(inline(' '.join(group)),sty['body']))
    if not re.fullmatch(r'[0-9a-f]{40}',SOURCE_SHA): raise ValueError('The document needs an actual fixed source commit before building.')
    document=BaseDocTemplate(str(OUTPUT),pagesize=A4,title='创宇宙 - Web赛道技术文档 v5',author='郭剑宇、单汝巨、栾健',subject='AI驱动的可搭建个人Web工作台',leftMargin=48,rightMargin=48,topMargin=63,bottomMargin=60,allowSplitting=1)
    document.addPageTemplates(PageTemplate(id='normal',frames=Frame(48,60,CONTENT,HEIGHT-123,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0),onPage=header_footer))
    document.build(story)
    print(OUTPUT)


if __name__=='__main__':
    if OUTPUT.exists() and '--rebuild' not in sys.argv:
        raise SystemExit('Output exists; keep the old deliverable or use --rebuild only during this draft review.')
    build()
