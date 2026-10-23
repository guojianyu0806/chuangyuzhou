import { resolveCompetitionOptions, prepareDataDirectory, loadOrCreateSetupCode, assertOrdinaryPath } from './runtime.mjs';
import { createWorkbenchServer, VERSION } from './backend/server.mjs';
import { createHermesService } from './backend/hermes.mjs';
import { createDeepSeekRunner } from './backend/deepseek.mjs';
import { createDocumentExtractor, loadExtractorConfig } from './backend/extractor.mjs';
import { isCliEntry } from './backend/is-cli.mjs';
import { MODEL_ENVIRONMENT_KEYS, readModelEnvironment } from './backend/model-environment.mjs';

export async function startCompetitionWorkbench(options = {}, env = process.env) {
  if (process.argv[1]) assertOrdinaryPath(process.argv[1]);
  const runtime = resolveCompetitionOptions(options, env);
  const modelEnvironment = Object.fromEntries(MODEL_ENVIRONMENT_KEYS.filter(key => Object.hasOwn(env, key)).map(key => [key, env[key]]));
  readModelEnvironment(modelEnvironment);
  prepareDataDirectory(runtime.dataDir);
  const setupToken = loadOrCreateSetupCode(runtime.setupTokenFile);
  const extractor = createDocumentExtractor(loadExtractorConfig());
  // Only the two model variables are forwarded; legacy engine paths stay isolated.
  const app = await createWorkbenchServer({ ...runtime, secureCookie: false,
    publicOrigin: `http://${runtime.host}:${runtime.port}`, setupToken, extractFile: extractor.extractFile,
    modelFactory: ({ dataDir, store }) => createHermesService({ dataDir, store, env: modelEnvironment,
      engine: 'deepseek-direct', runModel: createDeepSeekRunner(), extractFile: extractor.extractFile,
      extractionCapabilities: () => extractor.capabilities }),
    onError: () => console.error('创宇宙 · Web赛道开发版请求失败，请查看界面提示。'),
  });
  try {
    await new Promise((ready, reject) => { app.server.once('error', reject); app.server.listen(runtime.port, runtime.host, ready); });
  } catch (error) { await app.close(); throw error; }
  console.log(`创宇宙 · Web赛道开发版 ${VERSION} listening on ${runtime.host}:${runtime.port}`);
  console.log('首次使用请自行查看当前目录 .cu-runtime/data/setup-code.txt；不要向聊天提供口令或 Key。');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
  return app;
}

if (isCliEntry(import.meta.url)) await startCompetitionWorkbench();
