/**
 * 配置加载（零依赖：自带极简 .env 解析，不引入 dotenv）
 * 优先级：系统环境变量 > .env 文件 > 内置默认值
 */
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const f = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(f)) return;
  const text = fs.readFileSync(f, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const k = m[1];
    const v = m[2].replace(/^["']|["']$/g, '');
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnv();

const LLM_API_KEY = process.env.LLM_API_KEY || '';

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  LLM_BASE_URL: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
  LLM_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL || 'deepseek-chat',
  // 是否真正接入大模型：仅当配置了可用 Key 才为 true
  LLM_ENABLED: LLM_API_KEY.trim().length > 0,
  TOP_K: parseInt(process.env.TOP_K || '6', 10),
};
