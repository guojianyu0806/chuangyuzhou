// This module only consumes explicitly supplied values; importing it is offline.
export const MODEL_ENVIRONMENT_KEYS = Object.freeze(['DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL']);
export const SUPPORTED_DEEPSEEK_MODELS = Object.freeze(['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']);
const models = new Set(SUPPORTED_DEEPSEEK_MODELS);

export function readModelEnvironment(env = {}) {
  const apiKey = env.DEEPSEEK_API_KEY === undefined ? '' : env.DEEPSEEK_API_KEY;
  const model = env.DEEPSEEK_MODEL === '' || env.DEEPSEEK_MODEL === undefined ? 'deepseek-flash' : env.DEEPSEEK_MODEL;
  // Error messages deliberately omit the supplied value, including invalid input.
  if (typeof apiKey !== 'string' || (apiKey && (apiKey.length < 12 || apiKey.length > 500 || /[^\x21-\x7e]/.test(apiKey)))) throw new Error('DEEPSEEK_API_KEY 格式无效：需要12至500个不含空白的ASCII字符。');
  if (typeof model !== 'string' || !models.has(model)) throw new Error('DEEPSEEK_MODEL 无效：请选择本应用支持的DeepSeek模型。');
  // A model name alone must never borrow a saved key or alter its saved model.
  if (!apiKey) return null;
  return Object.freeze({provider:'deepseek', model, apiKey, baseUrl:'https://api.deepseek.com'});
}
