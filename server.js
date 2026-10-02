/**
 * 小哲用工风险检测系统（网页版）—— 服务器（免登录 · A1 版）
 *
 * A1 架构下服务器的职责只剩两件：
 *   1. 静态服务（public/ 下的页面与前端引擎 bundle）
 *   2. AI 代理（/api/ai/* 与 /api/config-key、/api/diagnose）—— 密钥不能下发到浏览器
 *
 * 所有业务数据（员工/合同/考勤/薪资/社保/证照/规则开关/问卷答案）都在浏览器
 * localStorage 里，由 public/js/api.js + engine-browser.js 本地读写与测算，
 * 不再经过本服务器，服务器不再做任何数据持久化。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const { corpus, quiz } = require('./src/corpus');
const { diagnose, chat, explainRisk, setRuntimeKey } = require('./src/agent');

const PORT = config.PORT;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      if (!parts.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));
      } catch (e) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const safe = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
  const file = path.join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  try {
    /* ---------- 健康检查 ---------- */
    if (pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        llmEnabled: config.LLM_ENABLED,
        model: config.LLM_ENABLED ? config.LLM_MODEL : null,
        corpusSize: corpus.length,
        quizCategories: quiz.length,
      });
    }

    /* ---------- 运行时配置大模型密钥（只影响本进程，不写盘） ---------- */
    if (pathname === '/api/config-key' && req.method === 'POST') {
      const b = await readBody(req);
      setRuntimeKey({
        apiKey: (b.apiKey || '').trim(),
        baseUrl: (b.baseUrl || '').trim(),
        model: (b.model || '').trim(),
      });
      return sendJson(res, 200, { ok: true, llmEnabled: config.LLM_ENABLED, model: config.LLM_MODEL });
    }

    /* ---------- AI 三接口（密钥留在服务端，浏览器不直接接触） ---------- */
    if (pathname === '/api/diagnose' && req.method === 'POST') {
      const b = await readBody(req);
      const result = await diagnose({ meta: b.meta || {}, answers: b.answers || {} });
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/ai/explain' && req.method === 'POST') {
      const b = await readBody(req);
      const result = await explainRisk(b.item || {}, b.companyName || '');
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/ai/chat' && req.method === 'POST') {
      const b = await readBody(req);
      const q = String(b.question || '').trim();
      if (!q) return sendJson(res, 400, { error: '缺少问题内容' });
      const result = await chat({ question: q, history: Array.isArray(b.history) ? b.history : [] });
      return sendJson(res, 200, result);
    }

    /* ---------- 其余 /api/* 已下线（A1：业务数据在浏览器 localStorage） ---------- */
    if (pathname.startsWith('/api/')) {
      return sendJson(res, 410, {
        error: '该接口已下线：免登录版所有业务数据只存在浏览器本地，不再走服务器。',
      });
    }

    return serveStatic(req, res, pathname);
  } catch (e) {
    return sendJson(res, 500, { error: String(e && e.message ? e.message : e) });
  }
});

server.listen(PORT, () => {
  console.log('===============================================');
  console.log(' 小哲用工风险检测系统（网页版 · 免登录 A1）已启动');
  console.log(` 访问地址： http://localhost:${PORT}`);
  console.log(` 数据存储： 浏览器 localStorage（服务器不落任何业务数据）`);
  console.log(` 知识库：   ${corpus.length} 条 · 规则 116 条 · 自检 ${quiz.length} 环节`);
  console.log(
    ` AI 模式：  ${config.LLM_ENABLED ? '真实大模型已接入（' + config.LLM_MODEL + '）' : '未配置密钥 → 本地规则引擎兜底（可在页面系统设置里粘贴密钥，立即生效）'}`
  );
  console.log('===============================================');
});
