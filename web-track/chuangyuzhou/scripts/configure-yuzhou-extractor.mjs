// Explicit local configuration only: no download, package installation or model request.
import { probePythonExtractor, saveExtractorConfig, DocumentExtractionError } from '../yuzhou/backend/extractor.mjs';
const args = process.argv.slice(2);
try {
  let pythonPath, replace = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--python' && !pythonPath && args[index + 1] && !args[index + 1].startsWith('--')) pythonPath = args[++index];
    else if (args[index] === '--replace' && !replace) replace = true;
    else throw new Error('arguments');
  }
  if (!pythonPath) throw new Error('arguments');
  const config = await probePythonExtractor(pythonPath);
  const result = saveExtractorConfig(config, { replace });
  console.log(JSON.stringify({ configured: true, changed: result.changed, configPath: result.path, capabilities: { txt: true, md: true, csv: true, docx: true, pptx: true, pdf: config.pdfAvailable, ocr: false } }, null, 2));
} catch (error) {
  console.error(error instanceof DocumentExtractionError ? error.message : '用法：node scripts/configure-yuzhou-extractor.mjs --python "已安装 Python 的绝对路径" [--replace]');
  process.exitCode = 1;
}
