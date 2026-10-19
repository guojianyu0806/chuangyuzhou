import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("extract", Path(__file__).resolve().parents[1] / "extract.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def zip_document(self, name, parts):
        path = self.root / name
        with zipfile.ZipFile(path, "w") as archive:
            for filename, content in parts.items():
                archive.writestr(filename, content)
        return path

    def test_chinese_text_encodings_and_limit(self):
        for encoding in ("utf-8", "utf-16", "gb18030"):
            path = self.root / "课程.txt"
            path.write_bytes("数据结构：顺序表与链表".encode(encoding))
            self.assertIn("链表", module.extract(path, path.name)["units"][0]["text"])
        path.write_text("数" * 70000, encoding="utf-8")
        result = module.extract(path, path.name)
        self.assertEqual(len(result["units"][0]["text"]), 60000)
        self.assertTrue(result["warnings"])

    def test_docx_tables_and_images_warning(self):
        path = self.zip_document("课件.docx", {"word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>课程笔记</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格内容</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>', "word/media/image1.png": b"fake"})
        result = module.extract(path, path.name)
        self.assertIn("表格内容", result["units"][0]["text"])
        self.assertTrue(any("OCR" in warning for warning in result["warnings"]))

    def test_pptx_uses_presentation_order_and_speaker_notes(self):
        drawing = lambda text: f'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>{text}</a:t></p:sld>'
        path = self.zip_document("课件.pptx", {
            "ppt/slides/slide1.xml": drawing("第二页内容"),
            "ppt/slides/slide2.xml": drawing("第一页内容"),
            "ppt/presentation.xml": '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>',
            "ppt/_rels/presentation.xml.rels": '<Relationships><Relationship Id="r1" Target="slides/slide1.xml" Type="http://example/slide"/><Relationship Id="r2" Target="slides/slide2.xml" Type="http://example/slide"/></Relationships>',
            "ppt/slides/_rels/slide2.xml.rels": '<Relationships><Relationship Target="../notesSlides/notesSlide2.xml" Type="http://example/notesSlide"/></Relationships>',
            "ppt/notesSlides/notesSlide2.xml": drawing("课堂补充解释"),
        })
        result = module.extract(path, path.name)
        self.assertEqual(result["units"][0]["label"], "幻灯片 1")
        self.assertIn("第一页内容", result["units"][0]["text"])
        self.assertIn("课堂补充解释", result["units"][0]["text"])
        self.assertIn("第二页内容", result["units"][1]["text"])

    def test_scanned_image_and_legacy_format_fail_truthfully(self):
        for extension, code in ((".png", "OCR_NOT_CONFIGURED"), (".ppt", "FILE_UNSUPPORTED")):
            path = self.root / ("原文件" + extension)
            path.write_bytes(b"original-content")
            with self.assertRaises(module.ExtractionError) as caught:
                module.extract(path, path.name)
            self.assertEqual(caught.exception.code, code)
            self.assertEqual(path.read_bytes(), b"original-content")

    def test_empty_file_does_not_invent_content(self):
        path = self.root / "空白.txt"
        path.write_text("   ", encoding="utf-8")
        with self.assertRaises(module.ExtractionError) as caught:
            module.extract(path, path.name)
        self.assertEqual(caught.exception.code, "NO_READABLE_TEXT")


if __name__ == "__main__":
    unittest.main()
