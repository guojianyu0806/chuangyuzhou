import { resolveCompetitionOptions, prepareDataDirectory, loadOrCreateSetupCode, assertOrdinaryPath } from './runtime.mjs';
import { createWorkbenchServer, VERSION } from './backend/server.mjs';
import { createHermesService } from './backend/hermes.mjs';
import { isCliEntry } from './backend/is-cli.mjs';

export async function startCompetitionWorkbench(options = {}, env = process.env) {
  if (process.argv[1]) assertOrdinaryPath(process.argv[1]);
  const runtime = resolveCompetitionOptions(options, env);
  prepareDataDirectory(runtime.dataDir);
  const setupToken = loadOrCreateSetupCode(runtime.setupTokenFile);
  // Legacy engine paths and credentials are deliberately not forwarded.
  const app = await createWorkbenchServer({ ...runtime, secureCookie: false,
    publicOrigin: `http://${runtime.host}:${runtime.port}`, setupToken,
    modelFactory: ({ dataDir, store }) => createHermesService({ dataDir, store, env: {} }),
    onError: () => console.error('传智杯副本请求失败，请查看界面提示。'),
  });
  try {
    await new Promise((ready, reject) => { app.server.once('error', reject); app.server.listen(runtime.port, runtime.host, ready); });
  } catch (error) { await app.close(); throw error; }
  console.log(`宇宙 ${VERSION} · 传智杯独立副本 listening on ${runtime.host}:${runtime.port}`);
  console.log('首次使用请自行查看本副本 .cu-runtime/data/setup-code.txt；不要向聊天提供口令或 Key。');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
  return app;
}

if (isCliEntry(import.meta.url)) await startCompetitionWorkbench();
