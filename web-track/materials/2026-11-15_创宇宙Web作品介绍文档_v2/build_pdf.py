"""Build the standalone introduction. Existing final PDFs are never overwritten."""
from __future__ import annotations

import argparse
import html
import math
import re
from io import BytesIO
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, Image, KeepTogether, PageBreak,
    PageTemplate, Paragraph, Spacer, Table, TableStyle,
)

HERE = Path(__file__).resolve().parent
SOURCE = HERE / '作品介绍正文.md'
FINAL = HERE / '创宇宙_Web赛道作品介绍文档_v2.pdf'
WIDTH, HEIGHT = A4
CONTENT = WIDTH - 96
TEAL = colors.HexColor('#14665F')
INK = colors.HexColor('#19342F')
MUTED = colors.HexColor('#596E68')
PALE = colors.HexColor('#F0F6F3')
RULE = colors.HexColor('#CDDCD6')
GOLD = colors.HexColor('#DAE7A0')


def fonts():
    font_root = Path('C:/Windows/Fonts')
    pdfmetrics.registerFont(TTFont('Body', str(font_root / 'Deng.ttf')))
    pdfmetrics.registerFont(TTFont('Bold', str(font_root / 'Dengb.ttf')))
    pdfmetrics.registerFont(TTFont('Mono', str(font_root / 'consola.ttf')))
    pdfmetrics.registerFontFamily('Body', normal='Body', bold='Bold', italic='Body', boldItalic='Bold')


def styles():
    base = dict(fontName='Body', textColor=INK, wordWrap='CJK', splitLongWords=True)
    def s(name, **kw):
        return ParagraphStyle(name, **(base | kw))
    return {
        'cover': s('cover', fontName='Bold', fontSize=40, leading=48, spaceBefore=24, spaceAfter=10),
        'h1': s('h1', fontName='Bold', fontSize=20, leading=28, spaceBefore=0, spaceAfter=13),
        'h2': s('h2', fontName='Bold', fontSize=12.4, leading=19, spaceBefore=9, spaceAfter=5),
        'subtitle': s('subtitle', fontSize=14, leading=21, textColor=MUTED, spaceAfter=16),
        'body': s('body', fontSize=10.2, leading=17.3, spaceAfter=9),
        'small': s('small', fontSize=8.4, leading=13, textColor=MUTED, spaceAfter=8),
        'cell': s('cell', fontSize=9.5, leading=15),
        'headcell': s('headcell', fontName='Bold', fontSize=9.8, leading=15, textColor=colors.white),
        'note': s('note', fontSize=10, leading=17, borderColor=RULE, borderWidth=.6,
                  borderPadding=10, backColor=PALE, spaceBefore=6, spaceAfter=12),
        'code': s('code', fontName='Mono', fontSize=9.2, leading=15),
        'guide': s('guide', fontName='Bold', fontSize=9.5, leading=16, textColor=TEAL, spaceBefore=8, spaceAfter=3),
    }


def inline(text):
    text = html.escape(text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'`(.+?)`', r'<font color="#14665F">\1</font>', text)
    return re.sub(r'https?://[^\s<]+', lambda m: '<link href="'+m[0]+'" color="#14665F">'+m[0]+'</link>', text)


class Diagram(Flowable):
    def __init__(self, kind, sty):
        super().__init__()
        self.kind, self.sty = kind, sty
        self.width = CONTENT
        self.height = {'cover': 164, 'workflow': 143, 'architecture': 184}[kind]

    def draw(self):
        c, w = self.canv, CONTENT
        def box(x, y, bw, bh, title, detail='', fill=PALE):
            c.setFillColor(fill); c.setStrokeColor(RULE)
            c.roundRect(x, y, bw, bh, 7, fill=1, stroke=1)
            p = Paragraph(inline('**'+title+'**'), self.sty['cell'])
            _, ph = p.wrap(bw-18, bh)
            p.drawOn(c, x+9, y+bh-ph-9)
            if detail:
                p = Paragraph(inline(detail), self.sty['small'])
                _, ph = p.wrap(bw-18, bh)
                p.drawOn(c, x+9, y+8)
        def arrow(x1, y1, x2, y2):
            c.setStrokeColor(TEAL); c.setLineWidth(1.1); c.line(x1,y1,x2,y2)
            angle=math.atan2(y2-y1,x2-x1)
            for delta in [-.45,.45]:
                c.line(x2,y2,x2-5*math.cos(angle+delta),y2-5*math.sin(angle+delta))
        if self.kind == 'cover':
            box(0,88,151,62,'自由搭建','模块 / 空间 / 个人工具')
            box(174,88,151,62,'AI伙伴','查询 / 规划 / 补充修订',GOLD)
            box(348,88,151,62,'用户决定','审核 / 确认 / 查看结果')
            arrow(153,119,171,119); arrow(327,119,345,119)
            box(0,5,w,60,'自己的工作台，持续积累的上下文','资料、想法、待办与日期在同一个个人Web工作台中组织')
            arrow(w/2,86,w/2,68)
        elif self.kind == 'workflow':
            gap=10; bw=(w-gap*2)/3
            items=[('提出目标','描述需求和时间'),('读取上下文','查询受支持记录'),('生成行动单','校验后展示方案'),
                   ('审核与修订','核对对象和日期'),('确认与保存','版本检查、形成回执'),('查看与有限撤销','刷新核对、保护后改')]
            for i,(title,detail) in enumerate(items):
                row,col=divmod(i,3)
                if row: col=2-col
                x=col*(bw+gap); y=80 if row==0 else 7
                box(x,y,bw,55,title,detail)
                if row==0 and col<2: arrow(x+bw+1,y+27,x+bw+gap-1,y+27)
                if row==1 and col>0: arrow(x-1,y+27,x-gap+1,y+27)
            arrow(w-12,78,w-12,65)
        else:
            box(0,130,w,50,'浏览器界面','自由画布 / 业务页面 / AI审核 / IndexedDB草稿与恢复')
            arrow(w/2,128,w/2,112)
            box(0,60,w,50,'同源Node.js服务','认证 / 状态版本 / 业务与文件API / AI后台任务')
            arrow(w/4,58,w/4,44); arrow(w*3/4,58,w*3/4,44)
            box(0,0,w/2-8,42,'SQLite与附件','账号、会话、工作区及原件')
            box(w/2+8,0,w/2-8,42,'DeepSeek HTTPS接口','用户触发AI时请求')


def make_table(lines, sty):
    rows=[]
    for line in lines:
        cells=[cell.strip() for cell in line.strip('|').split('|')]
        if all(re.fullmatch(r':?-+:?', cell) for cell in cells):
            continue
        rows.append(cells)
    assert all(len(row)==2 for row in rows)
    data=[[Paragraph(inline(cell),sty['headcell'] if i==0 else sty['cell']) for cell in row] for i,row in enumerate(rows)]
    t=Table(data,colWidths=[CONTENT*.23,CONTENT*.77],hAlign='LEFT',repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,0),TEAL),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,PALE]),
        ('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),
        ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),
        ('LINEBELOW',(0,-1),(-1,-1),.5,RULE),
    ]))
    return t


def build(output):
    fonts(); sty=styles(); lines=SOURCE.read_text(encoding='utf-8').splitlines()
    count=lines.count('<!-- PAGE -->')+1
    def header_footer(c, doc):
        c.saveState(); c.setFillColor(TEAL); c.rect(0,HEIGHT-9,WIDTH,9,fill=1,stroke=0)
        c.setFont('Body',8.2); c.setFillColor(MUTED)
        c.drawString(48,HEIGHT-34,'创宇宙 / AI Web网页开发挑战赛')
        c.drawRightString(WIDTH-48,HEIGHT-34,'作品介绍文档 v2')
        c.setStrokeColor(RULE); c.line(48,45,WIDTH-48,45)
        c.setFont('Body',8); c.drawString(48,30,'2026-11-15 / 源码 977ff30 / 云南大学 A组')
        c.drawRightString(WIDTH-48,30,f'{doc.page:02d} / {count:02d}')
        c.restoreState()
    story=[]; i=0; first=True
    while i<len(lines):
        line=lines[i].strip()
        if not line: i+=1; continue
        if line=='<!-- PAGE -->': story.append(PageBreak()); i+=1; continue
        if line==':::cover': story.extend([Diagram('cover',sty),Spacer(1,14)]); i+=1; continue
        if line.startswith('# '):
            story.append(Paragraph(inline(line[2:]),sty['cover'] if first else sty['h1'])); first=False; i+=1; continue
        if line.startswith('## '): story.append(Paragraph(inline(line[3:]),sty['h2'])); i+=1; continue
        if line.startswith(':::subtitle '): story.append(Paragraph(inline(line[12:]),sty['subtitle'])); i+=1; continue
        if line.startswith(':::guide '): story.append(Paragraph(inline(line[9:]),sty['guide'])); i+=1; continue
        if line.startswith(':::diagram '): story.extend([Diagram(line.split()[1],sty),Spacer(1,9)]); i+=1; continue
        if line.startswith(':::imagecrop '):
            _,rel,coords,width,caption=line.split(' ',4)
            bounds=tuple(map(int,coords.split(','))); width=float(width)
            with PILImage.open(HERE/rel) as source:
                assert 0<=bounds[0]<bounds[2]<=source.width and 0<=bounds[1]<bounds[3]<=source.height
                cropped=source.crop(bounds); iw,ih=cropped.size; stream=BytesIO(); cropped.save(stream,format='PNG'); stream.seek(0)
            im=Image(stream,width=width,height=width*ih/iw); im.hAlign='CENTER'
            story.append(KeepTogether([im,Spacer(1,5),Paragraph(inline(caption),sty['small']),Spacer(1,8)])); i+=1; continue
        if line.startswith('|'):
            group=[]
            while i<len(lines) and lines[i].strip().startswith('|'): group.append(lines[i].strip()); i+=1
            story.extend([make_table(group,sty),Spacer(1,8)]); continue
        if line.startswith('```'):
            group=[]; i+=1
            while i<len(lines) and not lines[i].startswith('```'): group.append(lines[i]); i+=1
            p=Paragraph('<br/>'.join(html.escape(s).replace(' ','&#160;') for s in group),sty['code'])
            t=Table([[p]],colWidths=[CONTENT]); t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),.5,RULE),('LEFTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
            story.extend([t,Spacer(1,8)]); i+=1; continue
        if line.startswith('> '): story.append(Paragraph(inline(line[2:]),sty['note'])); i+=1; continue
        group=[line]; i+=1
        while i<len(lines) and lines[i].strip() and not re.match(r'^(#|\||:::|```|<!--|> )',lines[i].strip()): group.append(lines[i].strip()); i+=1
        story.append(Paragraph(inline(' '.join(group)),sty['body']))
    doc=BaseDocTemplate(str(output),pagesize=A4,title='创宇宙 - Web赛道作品介绍文档 v2',author='郭剑宇、单汝巨、栾健',
                        subject='可搭建个人Web工作台：项目介绍、AI落地与本版优化',leftMargin=48,rightMargin=48,topMargin=63,bottomMargin=60)
    doc.addPageTemplates(PageTemplate(id='normal',frames=Frame(48,60,CONTENT,HEIGHT-123,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0),onPage=header_footer))
    doc.build(story)
    from pypdf import PdfReader
    actual=len(PdfReader(output).pages)
    if actual!=count: raise RuntimeError(f'Unexpected overflow: expected {count}, got {actual} pages; review the draft.')
    print(f'{output}\nPages: {actual}; bytes: {output.stat().st_size}')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=FINAL)
    args=parser.parse_args()
    if args.output.exists(): raise SystemExit('Output already exists. Choose a new draft path; preserve completed files.')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    build(args.output)
