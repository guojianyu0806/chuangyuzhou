// Runs the release application with a fixed local substitute for the topic model.
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorkbenchServer } from '../yuzhou/backend/server.mjs';
import { createHermesService } from '../yuzhou/backend/hermes.mjs';
import { ensureCanvas } from '../yuzhou/frontend/src/canvas.js';
import { createCustomBlock } from '../yuzhou/frontend/src/custom-blocks-model.js';
import { createWorkbench } from '../yuzhou/frontend/src/workbench-model.js';
import { initializeSpaces } from '../yuzhou/frontend/src/workspace-model.js';
import { portFree } from '../yuzhou/launch.mjs';
import { assertRuntimePath, loadOrCreateSetupCode, RUNTIME_ROOT } from '../yuzhou/runtime.mjs';

const port = 4398;
const origin = `http://localhost:${port}`;
const timestamp = '2026-11-16T00:00:00.000Z';
const exhibition = 'review-exhibition';
const checklist = 'block:review-checklist';
const reading = 'review-reading';

function exampleWorkspace() {
  const makeSpace = (id, title, description, color) => ({
    id, title, description, color, type: 'project', icon: 'star',
    createdAt: timestamp, updatedAt: timestamp, archived: false, files: [], notes: [],
  });
  const data = initializeSpaces({
    schema: 1, mode: 'personal',
    profile: { name: '评审演示（模拟模型）', major: '', provider: 'deepseek' },
    workbench: { ...createWorkbench('blank'), onboardingComplete: true },
    spaces: [
      makeSpace(exhibition, '校园创作展筹备', '统筹布展、志愿者和作品核对', '#7950f2'),
      makeSpace(reading, '周末阅读摘记', '与展览无关的个人阅读笔记', '#64a87f'),
    ],
    courses: [], tasks: [], captures: [], english: {}, updatedAt: timestamp,
  });
  createCustomBlock(data, {
    kind: 'checklist', title: '布展前核对', description: '核对校园创作展的最后几项准备',
    config: { items: [
      { id: 'labels', label: '核对作品标签', done: false },
      { id: 'volunteers', label: '确认志愿者到岗', done: false },
    ] },
  }, { id: checklist, now: timestamp });
  const canvas = ensureCanvas(data);
  Object.assign(canvas, { initialized: true, presentation: 'canvas', view: { x: 65, y: 43, zoom: 1 } });
  const positions = {
    [exhibition]: { x: 70, y: 25, w: 280, h: 240 }, [checklist]: { x: 390, y: 45, w: 275, h: 245 },
    [reading]: { x: 125, y: 335, w: 270, h: 220 }, ai: { x: 520, y: 350, w: 390, h: 260 },
  };
  for (const card of canvas.cards) {
    if (positions[card.id]) Object.assign(card, positions[card.id]);
  }
  return data;
}

async function simulateTopicModel({ user }) {
  const { cards } = JSON.parse(user);
  if (!Array.isArray(cards)) throw new Error('本机评审演示仅提供主题归类的模拟建议。');
  await delay(550);
  return { cards: cards.map(({ id }) => ({
    id,
    topic: id === reading ? '个人阅读' : id === exhibition || id === checklist ? '校园创作展' : null,
    reason: id === reading ? '个人阅读与本次展览无关。'
      : id === exhibition || id === checklist ? '这张卡片用于本次展览的准备。' : '样例中没有这张卡片的主题。',
  })) };
}

if (!await portFree(port)) throw new Error('4398 端口已占用，请关闭自己启动的审阅实例后重试。');
const parent = assertRuntimePath(join(RUNTIME_ROOT, 'review'));
await mkdir(parent, { recursive: true });
const dataDir = assertRuntimePath(await mkdtemp(join(parent, 'campus-')));
const setupTokenFile = join(dataDir, 'setup-code.txt');
const app = await createWorkbenchServer({
  dataDir, setupToken: loadOrCreateSetupCode(setupTokenFile), publicOrigin: origin,
  modelFactory: ({ dataDir, store }) => createHermesService({
    dataDir, store, engine: 'deepseek-direct',
    env: { DEEPSEEK_API_KEY: 'local-review-fixture-only' },
    engineAvailable: () => true, runModel: simulateTopicModel,
  }),
});
try {
  app.store.saveWorkspace(app.store.getWorkspace().revision, exampleWorkspace());
  await new Promise((ready, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, '127.0.0.1', ready);
  });
} catch (error) {
  await app.close();
  throw error;
}
console.log(`创宇宙 · 合成资料与模拟模型  ${origin}/`);
console.log(`首次创建演示账号时，请在本机查看初始化口令文件 ${setupTokenFile}`);
console.log('演示数据存放在独立目录。退出后再次运行会建立新的演示工作区。');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
