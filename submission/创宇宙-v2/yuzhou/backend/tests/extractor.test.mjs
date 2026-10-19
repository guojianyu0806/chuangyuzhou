import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, linkSync, symlinkSync, truncateSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RUNTIME_ROOT, assertRuntimePath } from '../../runtime.mjs';
import { createDocumentExtractor, DocumentExtractionError, loadExtractorConfig, saveExtractorConfig, probePythonExtractor, validatePythonPath } from '../extractor.mjs';

function fixture(t) {
  const parent = assertRuntimePath(join(RUNTIME_ROOT, 'extractor-tests'));
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'case-'));
  t.after(() => { assertRuntimePath(root); rmSync(root, { recursive: true, force: true }); });
  return root;
}
function put(root, name, content) { const path = join(root, name); writeFileSync(path, content); return path; }
const rejected = code => error => error instanceof DocumentExtractionError && error.code === code && Number.isInteger(error.status);
const python = [join(RUNTIME_ROOT, 'extractor-venv', 'Scripts', 'python.exe'), join(RUNTIME_ROOT, 'extractor-venv', 'bin', 'python')].find(existsSync);

test('native text works without Python and does not claim unavailable Office/PDF/OCR', async t => {
  const root = fixture(t); const extractor = createDocumentExtractor();
  assert.deepEqual(extractor.capabilities, { txt: true, md: true, csv: true, docx: false, pptx: false, pdf: false, ocr: false });
  for (const name of ['笔记.txt', '笔记.md', '笔记.markdown', '笔记.CSV']) {
    const result = await extractor.extractFile(put(root, name, '\ufeff 数据结构：链表\n第二行 '), name);
    assert.deepEqual(result, { units: [{ label: '全文', text: '数据结构：链表\n第二行' }], warnings: [] });
  }
  for (const name of ['notes.docx', 'notes.pptx', 'notes.pdf']) await assert.rejects(extractor.extractFile(put(root, name, 'fixture'), name), rejected('EXTRACTOR_UNAVAILABLE'));
});

test('native decoder handles UTF-16 BOM in either order and GB18030', async t => {
  const root = fixture(t); const extractor = createDocumentExtractor();
  const little = Buffer.from('\ufeff中文', 'utf16le');
  for (const [name, buffer] of [['le.txt', little], ['be.txt', Buffer.from(little).swap16()], ['gb.txt', Buffer.from([0xd6, 0xd0, 0xce, 0xc4])]]) {
    const result = await extractor.extractFile(put(root, name, buffer), name);
    assert.equal(result.units[0].text, '中文');
  }
});

test('native extractor limits Unicode characters without splitting surrogate pairs', async t => {
  const root = fixture(t); const text = '🚀'.repeat(60001);
  const result = await createDocumentExtractor().extractFile(put(root, 'large.txt', text), 'large.txt');
  assert.equal(Array.from(result.units[0].text).length, 60000);
  assert.equal(result.units[0].text, '🚀'.repeat(60000));
  assert.match(result.warnings[0], /60,000/);
});

test('empty, binary, unsupported and scanned inputs fail truthfully with unchanged originals', async t => {
  const root = fixture(t); const extractor = createDocumentExtractor();
  const cases = [
    ['empty.txt', ' \n\t ', 'NO_READABLE_TEXT'],
    ['binary.txt', Buffer.from([0x61, 0, 0x62]), 'NOT_TEXT'],
    ['control.txt', Buffer.from([0x61, 0x01, 0x62]), 'NOT_TEXT'],
    ['image.png', 'synthetic-image', 'OCR_NOT_CONFIGURED'],
    ['legacy.doc', 'synthetic-legacy', 'FILE_UNSUPPORTED'],
    ['bad.txt', Buffer.from([0xff]), 'TEXT_ENCODING'],
  ];
  for (const [name, input, code] of cases) {
    const path = put(root, name, input); const before = readFileSync(path);
    await assert.rejects(extractor.extractFile(path, name), rejected(code));
    assert.deepEqual(readFileSync(path), before);
  }
});

test('outside paths, hard links, directory links and oversized inputs are rejected', async t => {
  const root = fixture(t); const extractor = createDocumentExtractor();
  await assert.rejects(extractor.extractFile(join(RUNTIME_ROOT, '..', 'backend', 'extract.py'), 'source.txt'), rejected('COMPETITION_PATH_FORBIDDEN'));
  const original = put(root, 'original.txt', 'synthetic original'); const alias = join(root, 'alias.txt'); linkSync(original, alias);
  await assert.rejects(extractor.extractFile(alias, 'alias.txt'), rejected('COMPETITION_PATH_FORBIDDEN'));
  const actual = join(root, 'actual'); mkdirSync(actual); put(actual, 'fixture.txt', 'synthetic');
  const linked = join(root, 'linked'); symlinkSync(actual, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(extractor.extractFile(join(linked, 'fixture.txt'), 'fixture.txt'), rejected('COMPETITION_PATH_FORBIDDEN'));
  const large = put(root, 'too-large.txt', ''); truncateSync(large, 40 * 1024 * 1024 + 1);
  await assert.rejects(extractor.extractFile(large, 'large.txt'), rejected('FILE_LIMIT'));
  assert.equal(readFileSync(original, 'utf8'), 'synthetic original');
});

test('Python path must be an explicit ordinary installed interpreter', t => {
  const root = fixture(t);
  for (const candidate of ['python', 'python.exe', join(root, 'missing-python.exe'), put(root, 'other.exe', 'fixture')]) assert.throws(() => validatePythonPath(candidate), rejected('PYTHON_PATH_INVALID'));
  const fake = put(root, 'python.exe', 'fixture'); linkSync(fake, join(root, 'python3.exe'));
  assert.throws(() => validatePythonPath(fake), rejected('PYTHON_PATH_INVALID'));
});

test('configuration is confined, schema checked and only replaced explicitly', { skip: !python && 'No installed Python is available for the synthetic test.' }, t => {
  const root = fixture(t); const configPath = join(root, 'config.json');
  assert.deepEqual(loadExtractorConfig(configPath), {});
  const configured = { pythonPath: validatePythonPath(python), pdfAvailable: false };
  assert.equal(saveExtractorConfig(configured, { configPath }).changed, true);
  const before = readFileSync(configPath, 'utf8');
  assert.deepEqual(loadExtractorConfig(configPath), configured);
  assert.equal(saveExtractorConfig(configured, { configPath }).changed, false);
  assert.throws(() => saveExtractorConfig({ ...configured, pdfAvailable: true }, { configPath }), rejected('EXTRACTOR_CONFIG_EXISTS'));
  assert.equal(readFileSync(configPath, 'utf8'), before);
  assert.equal(saveExtractorConfig({ ...configured, pdfAvailable: true }, { configPath, replace: true }).changed, true);
  assert.equal(loadExtractorConfig(configPath).pdfAvailable, true);
  const malformed = put(root, 'malformed.json', '{"schemaVersion":1,"apiKey":"synthetic"}');
  assert.throws(() => loadExtractorConfig(malformed), rejected('EXTRACTOR_CONFIG_INVALID'));
  assert.throws(() => loadExtractorConfig(join(RUNTIME_ROOT, '..', 'README.md')), rejected('EXTRACTOR_CONFIG_INVALID'));
});

test('installed Python extracts synthetic DOCX/PPTX and available PDF without model dependencies', { skip: !python && 'No installed Python is available for the synthetic test.' }, async t => {
  const root = fixture(t); const config = await probePythonExtractor(python); const extractor = createDocumentExtractor(config);
  const env = { PATH: dirname(python), HOME: root, USERPROFILE: root, TEMP: root, TMP: root, TMPDIR: root };
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key];
  const script = `import sys,zipfile\nfrom pathlib import Path\nr=Path(sys.argv[1])\nwith zipfile.ZipFile(r/'fixture.docx','w') as z:\n z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Office synthetic text</w:t></w:r></w:p></w:body></w:document>')\n z.writestr('word/media/image1.png',b'fixture')\nwith zipfile.ZipFile(r/'fixture.pptx','w') as z:\n z.writestr('ppt/slides/slide1.xml','<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Slide synthetic text</a:t></p:sld>')\nif sys.argv[2]=='pdf':\n from pypdf import PdfWriter\n stream=b'BT /F1 12 Tf 50 750 Td (PDF synthetic text) Tj ET'\n from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject\n w=PdfWriter();p=w.add_blank_page(width=595,height=842);font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')});p[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):w._add_object(font)})});content=DecodedStreamObject();content.set_data(stream);p[NameObject('/Contents')]=w._add_object(content);w.write(r/'fixture.pdf');w.encrypt('synthetic-password');w.write(r/'encrypted.pdf')\n blank=PdfWriter();blank.add_blank_page(width=595,height=842);blank.write(r/'blank.pdf')\n`;
  const generated = spawnSync(python, ['-B', '-I', '-c', script, root, config.pdfAvailable ? 'pdf' : 'no-pdf'], { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 20000 });
  assert.equal(generated.status, 0, 'Synthetic document generation must succeed.');
  const docx = await extractor.extractFile(join(root, 'fixture.docx'), 'fixture.docx');
  assert.match(docx.units[0].text, /Office synthetic text/); assert.ok(docx.warnings.some(value => value.includes('OCR')));
  const pptx = await extractor.extractFile(join(root, 'fixture.pptx'), 'fixture.pptx');
  assert.match(pptx.units[0].text, /Slide synthetic text/); assert.ok(pptx.warnings.some(value => value.includes('顺序')));
  const malformed = put(root, 'broken.docx', 'invalid ZIP, synthetic-secret-not-for-output');
  await assert.rejects(extractor.extractFile(malformed, 'broken.docx'), error => rejected('EXTRACTION_FAILED')(error) && !error.message.includes('synthetic-secret'));
  if (config.pdfAvailable) {
    assert.equal(extractor.capabilities.pdf, true);
    const pdf = await extractor.extractFile(join(root, 'fixture.pdf'), 'fixture.pdf');
    assert.match(pdf.units[0].text, /PDF synthetic text/);
    await assert.rejects(extractor.extractFile(join(root, 'encrypted.pdf'), 'encrypted.pdf'), rejected('PDF_ENCRYPTED'));
    await assert.rejects(extractor.extractFile(join(root, 'blank.pdf'), 'blank.pdf'), rejected('NO_READABLE_TEXT'));
  } else assert.equal(extractor.capabilities.pdf, false);
});
