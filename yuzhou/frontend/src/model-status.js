// A saved credential is separate from an available execution engine.
export function engineAvailable(status) {
  if (typeof status?.engineAvailable === 'boolean') return status.engineAvailable;
  return status?.hermesAvailable === true;
}

export function modelReady(status) {
  return status?.configured === true && engineAvailable(status);
}

export function modelStatusLabel(status) {
  if (!status) return '模型状态待检查';
  if (!status.configured) return '模型密钥待配置';
  return engineAvailable(status) ? 'AI 调用条件已就绪' : '密钥已保存 · 引擎待配置';
}

export function modelEngineDescription(status) {
  if (status?.engine === 'deepseek-direct') {
    return engineAvailable(status)
      ? '本机工作台使用独立 DeepSeek 直连，无需安装 Hermes。只有发送 AI 请求才会调用模型；保存密钥与提取文档正文不会调用模型。'
      : '本机工作台的 DeepSeek 直连暂不可用，请检查工作台服务；密钥保存不代表连接测试成功。';
  }
  return engineAvailable(status)
    ? '独立 AI 引擎已配置，真实调用效果仍待验证。'
    : '独立 AI 引擎待配置。原工作台引擎不会自动复用；当前可使用手动整理与本地管理功能。';
}
