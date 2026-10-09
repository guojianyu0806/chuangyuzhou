import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { resolve, dirname, join, basename, extname, isAbsolute, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { assertOrdinaryPath, assertRuntimePath, RUNTIME_ROOT } from '../runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const EXTRACTOR_CONFIG_PATH = join(RUNTIME_ROOT, 'extractor-config.json');
const MAX_FILE = 40 * 1024 * 1024;
const MAX_TEXT = 60000;
const MAX_OUTPUT = 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv']);
const ERRORS = Object.freeze({
  COMPETITION_PATH_FORBIDDEN: ['只允许读取本比赛副本运行目录中的普通文件。', 400],
  PYTHON_PATH_INVALID: ['解析器需要明确指定已安装的普通 Python 程序文件。', 400],
  EXTRACTOR_CONFIG_INVALID: ['独立文件解析配置无效，请重新检查配置。', 503],
  EXTRACTOR_CONFIG_EXISTS: ['已存在不同的解析配置；确认替换时请显式使用 --replace。', 409],
  FILE_LIMIT: ['文件不存在或超过 40MB。', 413],
  NOT_TEXT: ['该文件不是可识别的纯文本。', 422],
  TEXT_ENCODING: ['无法识别文本编码，请另存为 UTF-8 后上传。', 422],
  EXTRACTOR_UNAVAILABLE: ['该格式的独立解析组件尚未配置，请先配置本比赛解析器。', 503],
  PDF_ENCRYPTED: ['PDF 已加密，请上传解除密码后的文件。', 422],
  DOCUMENT_ENCRYPTED: ['文档已加密，请先解除密码。', 422],
  ARCHIVE_LIMIT: ['文档解压后过大，无法安全解析。', 413],
  INVALID_DOCUMENT: ['无法可靠识别文档结构，请检查文件格式。', 422],
  OCR_NOT_CONFIGURED: ['当前尚未接入 OCR，无法读取图片文字。请上传可复制文字的 PDF 或文本资料。', 422],
  FILE_UNSUPPORTED: ['暂支持 TXT、Markdown、CSV、可复制文字的 PDF、PPTX 和 DOCX；旧版 PPT/DOC 请先另存为新格式。', 415],
  NO_READABLE_TEXT: ['文件未提取到可读文字，可能只有图片或扫描页；当前未接入 OCR，未生成推测内容。', 422],
  EXTRACTION_TIMEOUT: ['文件解析超时，请拆分较大的文档后重试。', 504],
  EXTRACTION_OUTPUT_LIMIT: ['解析结果超过处理上限，请拆分文档后重试。', 413],
  EXTRACTION_FAILED: ['文件解析失败，可能已损坏或格式不受支持。原文件仍保留。', 422],
});

/** Only fixed public messages leave this module; stderr and file paths never do. */
export class DocumentExtractionError extends Error {
  constructor(code = 'EXTRACTION_FAILED') {
    const safeCode = Object.hasOwn(ERRORS, code) ? code : 'EXTRACTION_FAILED';
    super(ERRORS[safeCode][0]);
    this.name = 'DocumentExtractionError'; this.code = safeCode; this.status = ERRORS[safeCode][1];
  }
}
const failure = code => new DocumentExtractionError(code);

export function validatePythonPath(value) {
  try {
    if (typeof value !== 'string' || !isAbsolute(value) || !/^python(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i.test(basename(value))) throw failure('PYTHON_PATH_INVALID');
    const path = assertOrdinaryPath(value, parse(resolve(value)).root);
    if (!lstatSync(path).isFile()) throw failure('PYTHON_PATH_INVALID');
    return path;
  } catch { throw failure('PYTHON_PATH_INVALID'); }
}

function runtimeFile(value) {
  let path;
  try { path = assertRuntimePath(value); } catch { throw failure('COMPETITION_PATH_FORBIDDEN'); }
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.size > MAX_FILE) throw failure('FILE_LIMIT');
    return path;
  } catch (error) { if (error instanceof DocumentExtractionError) throw error; throw failure('FILE_LIMIT'); }
}

function pythonEnvironment(pythonPath) {
  const home = assertRuntimePath(join(RUNTIME_ROOT, 'python-extractor'));
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { PATH: dirname(pythonPath), HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' });
  return { home, env };
}

function pythonJson(pythonPath, args, timeout = 45000) {
  const checkedPython = validatePythonPath(pythonPath);
  let context;
  try { context = pythonEnvironment(checkedPython); } catch { throw failure('COMPETITION_PATH_FORBIDDEN'); }
  const { home, env } = context;
  return new Promise((accept, reject) => {
    let settled = false, bytes = 0; const chunks = [];
    const child = spawn(checkedPython, ['-B', '-I', ...args], { cwd: home, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = error => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); reject(error); };
    const timer = setTimeout(() => stop(failure('EXTRACTION_TIMEOUT')), timeout); timer.unref();
    child.once('error', () => stop(failure('EXTRACTOR_UNAVAILABLE')));
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_OUTPUT) stop(failure('EXTRACTION_OUTPUT_LIMIT')); else chunks.push(chunk); });
    // Consume diagnostics without retaining them; they can contain local paths or document data.
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_OUTPUT) stop(failure('EXTRACTION_OUTPUT_LIMIT')); });
    child.once('close', code => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reject(failure('EXTRACTION_FAILED')); return; }
      if (value?.ok !== true || code !== 0) { reject(failure(value?.code)); return; }
      accept(value);
    });
  });
}

function nativeText(path) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.nlink > 1) throw failure('COMPETITION_PATH_FORBIDDEN');
    if (info.size > MAX_FILE) throw failure('FILE_LIMIT');
    const raw = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < raw.length) { const count = readSync(descriptor, raw, offset, raw.length - offset, offset); if (!count) break; offset += count; }
    const input = raw.subarray(0, offset);
    const utf16 = input.length >= 2 && ((input[0] === 0xff && input[1] === 0xfe) || (input[0] === 0xfe && input[1] === 0xff));
    if (!utf16 && input.includes(0)) throw failure('NOT_TEXT');
    const encodings = utf16 ? [input[0] === 0xff ? 'utf-16le' : 'utf-16be'] : ['utf-8', 'gb18030'];
    let text;
    for (const encoding of encodings) { try { text = new TextDecoder(encoding, { fatal: true }).decode(input); break; } catch {} }
    if (text === undefined) throw failure('TEXT_ENCODING');
    if (/[\x00-\x08\x0b\x0e-\x1f]/.test(text)) throw failure('NOT_TEXT');
    text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim();
    if (!text) throw failure('NO_READABLE_TEXT');
    // Bound Unicode code points, matching the Python extractor, without splitting emoji.
    const bounded = Array.from(text.slice(0, MAX_TEXT * 2 + 2));
    const truncated = bounded.length > MAX_TEXT;
    return { units: [{ label: '全文', text: bounded.slice(0, MAX_TEXT).join('') }], warnings: truncated ? ['文件文字超过 60,000 字符，本次仅处理前 60,000 字符，请拆分文件以完整整理。'] : [] };
  } catch (error) { if (error instanceof DocumentExtractionError) throw error; throw failure('EXTRACTION_FAILED'); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function checkedResult(value) {
  if (!Array.isArray(value.units) || value.units.length > 500 || !Array.isArray(value.warnings) || value.warnings.length > 30) throw failure('EXTRACTION_FAILED');
  let length = 0;
  const units = value.units.map(unit => {
    if (!unit || typeof unit.label !== 'string' || unit.label.length > 200 || typeof unit.text !== 'string') throw failure('EXTRACTION_FAILED');
    length += Array.from(unit.text).length;
    if (length > MAX_TEXT) throw failure('EXTRACTION_OUTPUT_LIMIT');
    return { label: unit.label, text: unit.text };
  });
  if (!length) throw failure('NO_READABLE_TEXT');
  const warnings = value.warnings.map(warning => { if (typeof warning !== 'string' || warning.length > 2000) throw failure('EXTRACTION_FAILED'); return warning; });
  return { units, warnings };
}

export function createDocumentExtractor({ pythonPath, pdfAvailable = false } = {}) {
  const python = pythonPath ? validatePythonPath(pythonPath) : undefined;
  const capabilities = Object.freeze({ txt: true, md: true, csv: true, docx: Boolean(python), pptx: Boolean(python), pdf: Boolean(python && pdfAvailable), ocr: false });
  return {
    capabilities,
    async extractFile(value, name) {
      const path = runtimeFile(value);
      if (typeof name !== 'string' || name.length > 512 || /[\x00-\x1f]/.test(name)) throw failure('FILE_UNSUPPORTED');
      const extension = extname(name).toLowerCase();
      if (TEXT_EXTENSIONS.has(extension)) return nativeText(path);
      if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff'].includes(extension)) throw failure('OCR_NOT_CONFIGURED');
      if (!['.docx', '.pptx', '.pdf'].includes(extension)) throw failure('FILE_UNSUPPORTED');
      if (!python || (extension === '.pdf' && !pdfAvailable)) throw failure('EXTRACTOR_UNAVAILABLE');
      let script;
      try { script = assertOrdinaryPath(join(HERE, 'extract.py')); } catch { throw failure('COMPETITION_PATH_FORBIDDEN'); }
      return checkedResult(await pythonJson(python, [script, path, name]));
    },
  };
}

function checkedConfiguration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 || typeof value.pdfAvailable !== 'boolean' || Object.keys(value).some(key => !['schemaVersion', 'pythonPath', 'pdfAvailable'].includes(key))) throw failure('EXTRACTOR_CONFIG_INVALID');
  try { return { pythonPath: validatePythonPath(value.pythonPath), pdfAvailable: value.pdfAvailable }; } catch { throw failure('EXTRACTOR_CONFIG_INVALID'); }
}

/** This dedicated non-secret configuration is the only file read during initialization. */
export function loadExtractorConfig(configPath = EXTRACTOR_CONFIG_PATH) {
  let path;
  try { path = assertRuntimePath(configPath); } catch { throw failure('EXTRACTOR_CONFIG_INVALID'); }
  if (!existsSync(path)) return {};
  try {
    if (!lstatSync(path).isFile() || lstatSync(path).size > 8192) throw failure('EXTRACTOR_CONFIG_INVALID');
    return checkedConfiguration(JSON.parse(readFileSync(path, 'utf8')));
  } catch { throw failure('EXTRACTOR_CONFIG_INVALID'); }
}

export async function probePythonExtractor(pythonPath) {
  const python = validatePythonPath(pythonPath);
  const code = 'import json,sys,zipfile,xml.etree.ElementTree\nsys.stdout.reconfigure(encoding="utf-8")\ntry:\n import pypdf\n pdf=True\nexcept ImportError:\n pdf=False\nprint(json.dumps({"ok":True,"pdfAvailable":pdf}))';
  const result = await pythonJson(python, ['-c', code], 15000);
  if (typeof result.pdfAvailable !== 'boolean') throw failure('EXTRACTOR_UNAVAILABLE');
  return { pythonPath: python, pdfAvailable: result.pdfAvailable };
}

export function saveExtractorConfig(config, { replace = false, configPath = EXTRACTOR_CONFIG_PATH } = {}) {
  const value = { schemaVersion: 1, pythonPath: config.pythonPath, pdfAvailable: config.pdfAvailable };
  checkedConfiguration(value);
  let path;
  try { path = assertRuntimePath(configPath); } catch { throw failure('EXTRACTOR_CONFIG_INVALID'); }
  if (existsSync(path)) {
    let previous;
    try { previous = loadExtractorConfig(path); } catch (error) { if (!replace) throw error; }
    if (previous?.pythonPath === value.pythonPath && previous?.pdfAvailable === value.pdfAvailable) return { changed: false, path };
    if (!replace) throw failure('EXTRACTOR_CONFIG_EXISTS');
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = assertRuntimePath(path + '.' + randomUUID() + '.tmp');
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    assertRuntimePath(path);
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return { changed: true, path };
}
