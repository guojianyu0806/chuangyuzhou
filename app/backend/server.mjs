import {isCliEntry} from './is-cli.mjs';

const message='此文件仅为宇宙原后端的来源入口标记，禁止在创宇宙副本启动。完整来源代码保存在冻结备份；请从副本根目录运行 node start.mjs。';
export function createWorkbenchServer(){throw new Error(message);}
if(isCliEntry(import.meta.url)){
  console.error(message);
  process.exitCode=1;
}
