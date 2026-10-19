#!/usr/bin/env python3
"""Bounded text extraction only. Never executes macros, URLs or embedded objects."""
import json
import os
import posixpath
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

MAX_FILE = 40 * 1024 * 1024
MAX_TEXT = 60000
MAX_UNPACKED = 80 * 1024 * 1024
MAX_UNITS = 500


class ExtractionError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def clean(value):
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", value).strip()


def extract(path, name):
    file_path = Path(path)
    if not file_path.is_file() or file_path.stat().st_size > MAX_FILE:
        raise ExtractionError("FILE_LIMIT", "文件不存在或超过 40MB。")
    suffix = Path(name).suffix.lower()
    units, warnings = [], []
    if suffix in (".txt", ".md", ".markdown", ".csv"):
        raw = file_path.read_bytes()
        if b"\x00" in raw and not raw.startswith((b"\xff\xfe", b"\xfe\xff")):
            raise ExtractionError("NOT_TEXT", "该文件不是可识别的纯文本。")
        encodings = ("utf-16",) if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else ("utf-8-sig", "gb18030")
        text = None
        for encoding in encodings:
            try:
                text = raw.decode(encoding)
                break
            except UnicodeDecodeError:
                pass
        if text is None:
            raise ExtractionError("TEXT_ENCODING", "无法识别文本编码，请另存为 UTF-8 后上传。")
        units.append({"label": "全文", "text": clean(text)})
    elif suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError:
            raise ExtractionError("EXTRACTOR_UNAVAILABLE", "PDF 解析组件尚未安装。")
        reader = PdfReader(str(file_path))
        if reader.is_encrypted and not reader.decrypt(""):
            raise ExtractionError("PDF_ENCRYPTED", "PDF 已加密，请上传解除密码后的文件。")
        count = len(reader.pages)
        if count > MAX_UNITS:
            warnings.append("PDF 超过 500 页，本次仅处理前 500 页。")
        blank, total = 0, 0
        for index, page in enumerate(reader.pages[:MAX_UNITS]):
            text = clean(page.extract_text() or "")
            if not text:
                blank += 1
            units.append({"label": f"第 {index + 1} 页", "text": text})
            total += len(text)
            if total > MAX_TEXT:
                break
        if blank:
            warnings.append(f"{blank} 页未提取到文本，可能是扫描页或图片；当前未接入 OCR，未分析这些页面。")
    elif suffix in (".docx", ".pptx"):
        with zipfile.ZipFile(file_path) as archive:
            infos = archive.infolist()
            if len(infos) > 10000 or sum(item.file_size for item in infos) > MAX_UNPACKED:
                raise ExtractionError("ARCHIVE_LIMIT", "文档解压后过大，无法安全解析。")
            if any(item.flag_bits & 1 for item in infos):
                raise ExtractionError("DOCUMENT_ENCRYPTED", "文档已加密，请先解除密码。")
            if suffix == ".docx":
                if "word/document.xml" not in archive.namelist():
                    raise ExtractionError("INVALID_DOCUMENT", "无法识别 Word 文档结构。")
                root = ET.fromstring(archive.read("word/document.xml"))
                ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
                paragraphs = ["".join((node.text or "") for node in para.iter(ns + "t")) for para in root.iter(ns + "p")]
                units.append({"label": "正文（不含图片）", "text": clean("\n".join(paragraphs))})
                if any(info.filename.startswith("word/media/") for info in infos):
                    warnings.append("Word 图片中的文字未识别，当前未接入 OCR。")
            else:
                slides = sorted((name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)), key=lambda value: int(re.search(r"slide(\d+)\.xml", value).group(1)))
                if not slides:
                    raise ExtractionError("INVALID_DOCUMENT", "无法识别 PowerPoint 文档结构。")
                names = set(archive.namelist())
                if "ppt/presentation.xml" in names and "ppt/_rels/presentation.xml.rels" in names:
                    relationships = ET.fromstring(archive.read("ppt/_rels/presentation.xml.rels"))
                    slide_targets = {node.attrib.get("Id"): posixpath.normpath(posixpath.join("ppt", node.attrib.get("Target", ""))).lstrip("/") for node in relationships if node.attrib.get("TargetMode") != "External" and node.attrib.get("Type", "").endswith("/slide")}
                    presentation = ET.fromstring(archive.read("ppt/presentation.xml"))
                    ordered = [slide_targets.get(node.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")) for node in presentation.iter("{http://schemas.openxmlformats.org/presentationml/2006/main}sldId")]
                    if not ordered or any(target not in slides for target in ordered):
                        raise ExtractionError("INVALID_DOCUMENT", "PPT 幻灯片顺序信息异常，无法可靠解析。")
                    slides = ordered
                else:
                    warnings.append("PPT 缺少展示顺序信息，下列页码按内部幻灯片编号排列，请核对。")
                if len(slides) > MAX_UNITS:
                    warnings.append("PPT 超过 500 页，本次仅处理前 500 页。")
                for index, slide in enumerate(slides[:MAX_UNITS]):
                    root = ET.fromstring(archive.read(slide))
                    text = "\n".join((node.text or "") for node in root.iter("{http://schemas.openxmlformats.org/drawingml/2006/main}t"))
                    relationship_path = f"ppt/slides/_rels/{posixpath.basename(slide)}.rels"
                    if relationship_path in names:
                        relationships = ET.fromstring(archive.read(relationship_path))
                        for node in relationships:
                            if node.attrib.get("TargetMode") != "External" and node.attrib.get("Type", "").endswith("/notesSlide"):
                                target = posixpath.normpath(posixpath.join("ppt/slides", node.attrib.get("Target", ""))).lstrip("/")
                                if target in names and target.startswith("ppt/notesSlides/"):
                                    notes = ET.fromstring(archive.read(target))
                                    note_text = "\n".join((value.text or "") for value in notes.iter("{http://schemas.openxmlformats.org/drawingml/2006/main}t"))
                                    if note_text.strip():
                                        text += "\n[讲者备注]\n" + note_text
                    units.append({"label": f"幻灯片 {index + 1}", "text": clean(text)})
                    if sum(len(unit["text"]) for unit in units) > MAX_TEXT:
                        break
                if any(info.filename.startswith("ppt/media/") for info in infos):
                    warnings.append("PPT 中的图片、图表图像和公式截图未识别，当前未接入 OCR。")
    elif suffix in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"):
        raise ExtractionError("OCR_NOT_CONFIGURED", "当前尚未接入 OCR，无法读取图片文字。请上传可复制文字的 PDF 或文本资料。")
    else:
        raise ExtractionError("FILE_UNSUPPORTED", "暂支持 TXT、Markdown、CSV、可复制文字的 PDF、PPTX 和 DOCX；旧版 PPT/DOC 请先另存为新格式。")
    remaining, bounded = MAX_TEXT, []
    truncated = False
    for unit in units:
        if not unit["text"]:
            continue
        content = unit["text"][:remaining]
        if len(content) < len(unit["text"]):
            truncated = True
        if content:
            bounded.append({"label": unit["label"], "text": content})
            remaining -= len(content)
        if remaining == 0:
            truncated = True
            break
    if truncated:
        warnings.append("文件文字超过 60,000 字符，本次仅处理前 60,000 字符，请拆分文件以完整整理。")
    if not bounded:
        raise ExtractionError("NO_READABLE_TEXT", "文件未提取到可读文字，可能只有图片或扫描页；当前未接入 OCR，未生成推测内容。")
    return {"units": bounded, "warnings": warnings}


def main():
    try:
        if sys.platform != "win32":
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_CPU, (35, 35))
        if len(sys.argv) != 3:
            raise ExtractionError("BAD_ARGUMENTS", "文档解析参数错误。")
        result = extract(sys.argv[1], sys.argv[2])
        print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    except ExtractionError as error:
        print(json.dumps({"ok": False, "code": error.code, "message": error.message}, ensure_ascii=False))
        sys.exit(1)
    except Exception:
        print(json.dumps({"ok": False, "code": "EXTRACTION_FAILED", "message": "文件解析失败，可能已损坏或格式不受支持。原文件仍保留。"}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
