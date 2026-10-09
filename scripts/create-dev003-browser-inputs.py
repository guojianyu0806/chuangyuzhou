"""Synthetic files for manual UI checks; no user material or external calls."""
import zipfile
from pathlib import Path
from reportlab.pdfgen import canvas
project = Path(__file__).absolute().parents[1]
runtime = project / "yuzhou" / ".cu-runtime"
# Refuse a linked ancestor instead of creating synthetic files outside this copy.
if project.resolve() != project or runtime.resolve() != runtime or not runtime.is_dir():
    raise SystemExit("A physical competition runtime directory is required.")
root = runtime / "dev003-browser-inputs"
if root.exists():
    raise SystemExit("Synthetic inputs already exist; refusing to overwrite.")
root.mkdir()
(root / "sample.txt").write_text("DEV-003 合成课件：请核对比赛说明。", encoding="utf-8")
with zipfile.ZipFile(root / "sample.docx", "x") as archive:
    archive.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DEV-003 Word 合成正文：课程资料可在本机提取。</w:t></w:r></w:p></w:body></w:document>')
with zipfile.ZipFile(root / "sample.pptx", "x") as archive:
    archive.writestr("ppt/slides/slide1.xml", '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>DEV-003 PPT 合成正文：保留原件并核对文本。</a:t></a:r></a:p></p:sld>')
pdf=canvas.Canvas(str(root / "sample.pdf"));pdf.drawString(72,760,"DEV-003 synthetic PDF: local extraction verified.");pdf.save()
print("Created four synthetic document fixtures in the competition runtime.")
