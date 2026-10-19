"""Render the new DEV-032 Markdown report; refuse to overwrite any PDF/render set."""
from pathlib import Path
import argparse, html, re, json, hashlib
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, Flowable, KeepTogether
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
INK = colors.HexColor('#25243C')
PURPLE = colors.HexColor('#7650D7')
MUTED = colors.HexColor('#66627B')
PALE = colors.HexColor('#F4F1FB')
LINE = colors.HexColor('#E1DCEC')
FONT = 'CJK'
BOLD = 'CJK-Bold'

def checked_new(path):
    path = path.resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('Output outside competition directory')
    if path.exists():
        raise FileExistsError(f'Preserve previous output: {path}')
    # Reject reparse-point ancestors before creating directories.
    for parent in [path.parent, *path.parents]:
        if parent == ROOT.parent:
            break
        if parent.exists() and (parent.is_symlink() or parent.is_junction()):
            raise ValueError('Linked output parent')
    path.parent.mkdir(parents=True, exist_ok=True)
    return path

def markup(text):
    text = html.escape(text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'`(.+?)`', r'<font color="#7650D7">\1</font>', text)
    return text

class Diagram(Flowable):
    def __init__(self, kind, width):
        super().__init__()
        self.kind, self.width = kind, width
        self.height = {'overview': 125, 'architecture': 194, 'workflow': 135, 'miniapp': 147}[kind]

    def draw(self):
        c, w = self.canv, self.width
        def box(x, y, bw, bh, title, desc, tint=PALE):
            c.setFillColor(tint); c.setStrokeColor(LINE)
            c.roundRect(x, y, bw, bh, 9, stroke=1, fill=1)
            c.setFillColor(INK); c.setFont(BOLD, 10)
            c.drawCentredString(x+bw/2, y+bh-21, title)
            c.setFillColor(MUTED); c.setFont(FONT, 8.4)
            c.drawCentredString(x+bw/2, y+12, desc)
        def arrow(x1, y1, x2, y2):
            c.setStrokeColor(PURPLE); c.setLineWidth(1.15); c.line(x1, y1, x2, y2)
            if y1 == y2:
                c.line(x2-4,y2+3,x2,y2); c.line(x2-4,y2-3,x2,y2)
            else:
                c.line(x2-3,y2+4,x2,y2); c.line(x2+3,y2+4,x2,y2)
        if self.kind == 'overview':
            gap = 12; bw = (w-gap*2)/3
            for i, (a,b) in enumerate([('自主搭建','模块 · 模板 · 自由画布'),('AI伙伴','查询 · 方案 · 审核执行'),('受控扩展','配置方块 · 交互小程序')]):
                box(i*(bw+gap),28,bw,72,a,b)
        elif self.kind == 'architecture':
            box(0,134,w,50,'浏览器：搭建 / 画布 / 业务页面 / AI审核','展示与直接操作；确认后执行受支持行动')
            arrow(w/2,134,w/2,117)
            box(0,64,w*.60,53,'Node HTTP与业务服务','认证 · 状态版本 · 查询 · 响应校验')
            box(w*.64,64,w*.36,53,'模型适配器','DeepSeek / 可选Hermes')
            arrow(w*.60,90,w*.64,90)
            arrow(w*.30,64,w*.30,48)
            box(0,0,w*.60,48,'独立SQLite与附件目录','本副本账号、业务和运行数据')
            box(w*.64,0,w*.36,48,'扩展能力','正文提取 / 小程序运行器')
        elif self.kind == 'workflow':
            gap=10; bw=(w-gap*3)/4
            for i,(a,b) in enumerate([('提出需求','明确对象与目标'),('查询现状','协议约束与实际记录'),('审核 / 修订','未确认不写入'),('确认执行','版本与行动校验')]):
                box(i*(bw+gap),64,bw,58,a,b)
                if i<3: arrow((i+1)*bw+i*gap,93,(i+1)*(bw+gap),93)
            c.setFillColor(MUTED); c.setFont(FONT,10)
            c.drawCentredString(w/2,29,'执行回执 → 关联结果 → 刷新复核 → 有边界撤销')
            c.setStrokeColor(LINE); c.line(24,14,w-24,14)
        else:
            bw=(w-18)/2
            box(0,76,bw,60,'配置型方块','字段、条目与内容')
            box(bw+18,76,bw,60,'代码型小程序','受控组件与注入API')
            arrow(bw/2,76,bw/2,59); arrow(bw+18+bw/2,76,bw+18+bw/2,59)
            box(0,0,w,59,'共同边界：先审核保存，再按需手动运行','配置与数据分离；预览不落库；保留后续编辑')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--render-dir', required=True)
    args=parser.parse_args()
    out=checked_new(ROOT/args.output)
    renders=checked_new(ROOT/args.render_dir)
    renders.mkdir()
    pdfmetrics.registerFont(TTFont(FONT, 'C:/Windows/Fonts/msyh.ttc', subfontIndex=0))
    pdfmetrics.registerFont(TTFont(BOLD, 'C:/Windows/Fonts/msyhbd.ttc', subfontIndex=0))
    pdfmetrics.registerFontFamily(FONT, normal=FONT, bold=BOLD)
    styles={
        'body':ParagraphStyle('body',fontName=FONT,fontSize=10.3,leading=17.2,textColor=INK,spaceAfter=9,wordWrap='CJK'),
        'h1':ParagraphStyle('h1',fontName=BOLD,fontSize=23,leading=31,textColor=INK,spaceAfter=18,wordWrap='CJK'),
        'h2':ParagraphStyle('h2',fontName=BOLD,fontSize=17,leading=25,textColor=PURPLE,spaceAfter=15,wordWrap='CJK'),
        'h3':ParagraphStyle('h3',fontName=BOLD,fontSize=12,leading=18,textColor=PURPLE,spaceBefore=10,spaceAfter=7,wordWrap='CJK'),
        'cell':ParagraphStyle('cell',fontName=FONT,fontSize=8.6,leading=13.5,textColor=INK,wordWrap='CJK'),
        'caption':ParagraphStyle('caption',fontName=FONT,fontSize=8.2,leading=12,textColor=MUTED,spaceBefore=5,spaceAfter=11,wordWrap='CJK'),
        'code':ParagraphStyle('code',fontName=FONT,fontSize=9.3,leading=15,textColor=INK,backColor=PALE,borderPadding=8,spaceAfter=12,wordWrap='CJK'),
    }
    source=HERE/'技术文档-正式提交版-v1.md'
    text=source.read_text(encoding='utf-8')
    parts=text.split('<!-- PAGE -->')
    w=A4[0]-88
    doc=SimpleDocTemplate(str(out),pagesize=A4,rightMargin=44,leftMargin=44,topMargin=49,bottomMargin=44,title='创宇宙 - AI辅助开发的可组合个人工作空间',author='创宇宙项目',subject='传智杯AI创新应用挑战赛技术文档 正式提交版 v1')
    story=[]
    source_images=[]
    for page_index,part in enumerate(parts):
        if page_index: story.append(PageBreak())
        lines=part.strip().splitlines(); i=0
        while i<len(lines):
            s=lines[i].strip(); i+=1
            if not s: continue
            if s.startswith(':::'):
                story.extend([Diagram(s[3:],w),Spacer(1,9)]); continue
            if s.startswith('```'):
                code=[]
                while i<len(lines) and not lines[i].startswith('```'):
                    code.append(html.escape(lines[i])); i+=1
                i+=1
                story.append(Paragraph('<br/>'.join(code),styles['code'])); continue
            if s.startswith('|'):
                rows=[s]
                while i<len(lines) and lines[i].strip().startswith('|'):
                    rows.append(lines[i].strip()); i+=1
                data=[]
                for row in rows:
                    cells=[x.strip() for x in row.strip('|').split('|')]
                    if all(re.fullmatch(r'[:\- ]+',x) for x in cells): continue
                    data.append([Paragraph(markup(x),styles['cell']) for x in cells])
                n=len(data[0]); ratios=[.24,.43,.33] if n==3 else [1/n]*n
                if page_index==12: ratios=[.075,.61,.315]
                t=Table(data,colWidths=[w*x for x in ratios],repeatRows=1,hAlign='LEFT')
                t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#EAE3F8')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,0),.7,LINE),('LINEBELOW',(0,1),(-1,-1),.4,LINE),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#FAF9FC')])]))
                story.extend([t,Spacer(1,10)]); continue
            m=re.fullmatch(r'!\[(.*?)\]\((.*?)\)',s)
            if m:
                from PIL import Image as PILImage
                path=(HERE/m[2]).resolve()
                if not path.is_relative_to(ROOT): raise ValueError('External image source')
                with PILImage.open(path) as im: iw,ih=im.size
                scale=min(w/iw,250/ih)
                fig=Image(str(path),iw*scale,ih*scale,hAlign='CENTER')
                story.append(KeepTogether([fig,Paragraph(markup(m[1]),styles['caption'])]))
                source_images.append({'path':str(path.relative_to(ROOT)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
                continue
            key='body'
            for prefix,k in [('### ','h3'),('## ','h2'),('# ','h1')]:
                if s.startswith(prefix): key=k; s=s[len(prefix):]; break
            story.append(Paragraph(markup(s),styles[key]))
    def decorate(c,d):
        c.saveState()
        c.setStrokeColor(LINE); c.setLineWidth(.6); c.line(44,A4[1]-33,A4[0]-44,A4[1]-33)
        c.setFont(FONT,8); c.setFillColor(MUTED)
        c.drawString(44,A4[1]-25,'创宇宙  /  AI创新应用挑战赛')
        c.drawRightString(A4[0]-44,A4[1]-25,'技术文档 · 正式提交版 v1')
        c.setFont(FONT,8); c.drawString(44,25,'2026-10-19  ·  来源与验证范围见文末索引')
        c.drawRightString(A4[0]-44,25,f'{d.page:02d}')
        c.restoreState()
    doc.build(story,onFirstPage=decorate,onLaterPages=decorate)
    reader=PdfReader(out)
    pdf=pdfium.PdfDocument(str(out))
    page_text=[]
    for index,page in enumerate(pdf):
        bitmap=page.render(scale=1.4)
        image=bitmap.to_pil()
        image.save(renders/f'page-{index+1:02d}.png')
        page_text.append(reader.pages[index].extract_text())
        image.close(); bitmap.close(); page.close()
    pdf.close()
    result={'pdf':str(out.relative_to(ROOT)),'pages':len(reader.pages),'expectedPages':len(parts),'pageCountWithinLimit':len(reader.pages)<=30,'plannedPaginationMatches':len(reader.pages)==len(parts),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(out.read_bytes()).hexdigest(),'sourceImages':source_images,'pageTextLengths':[len(x) for x in page_text]}
    (renders/'render-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    (renders/'extracted.txt').write_text('\n\n'.join(page_text),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))
    if not result['plannedPaginationMatches']: raise SystemExit('Unexpected page spill; preserve this PDF and revise to a new version')

if __name__=='__main__': main()
