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
  if (status.configurationManaged === true || status.configurationSource === 'environment') return engineAvailable(status) ? '环境变量已配置 · AI 调用条件已就绪' : '环境变量已配置 · 引擎待配置';
  return engineAvailable(status) ? 'AI 调用条件已就绪' : '密钥已保存 · 引擎待配置';
}

export function modelEngineDescription(status) {
  const configuration = status?.configurationManaged === true || status?.configurationSource === 'environment' ? '模型由启动环境配置，修改后重启工作台。' : '';
  if (status?.engine === 'deepseek-direct') {
    return configuration + (engineAvailable(status)
      ? '工作台服务使用 DeepSeek 直连，无需安装 Hermes。只有发送 AI 请求才会调用模型；保存密钥与提取文档正文不会调用模型。'
      : '工作台服务的 DeepSeek 直连暂不可用，请检查服务；配置密钥不代表连接测试成功。');
  }
  return configuration + (engineAvailable(status)
    ? '独立 AI 引擎已配置，真实调用效果仍待验证。'
    : '独立 AI 引擎待配置。原工作台引擎不会自动复用；当前可使用手动整理与本地管理功能。');
}
