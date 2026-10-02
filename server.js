/**
 * 用工管家 AI Agent —— Web 服务端
 *
 * 零第三方依赖：仅用 Node 内置 http 模块，clone 下来无需 npm install 即可运行。
 * AI 能力走真实大模型（OpenAI 兼容协议），密钥可在页面「系统设置」里随时粘贴、立即生效。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const db = require('./src/db');
const { scan } = require('./src/engine');
const { corpus, quiz } = require('./src/corpus');
const { diagnose, chat, explainRisk, setRuntimeKey } = require('./src/agent');

const PORT = config.PORT;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

const COLLECTIONS = [
  'employees', 'contracts', 'attendances', 'payrolls', 'socials', 'certs',
  'confirms', 'surveys', 'riskItems', 'applies', 'approvals', 'flows',
  'users', 'members', 'invites', 'audit',
];

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 8e6) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
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

/** 组装扫描所需的完整数据快照 */
function snapshot() {
  const d = db.load();
  return {
    employees: d.employees, contracts: d.contracts, attendances: d.attendances,
    payrolls: d.payrolls, socials: d.socials, certs: d.certs,
    settings: d.settings, ruleCfg: d.ruleCfg, confirms: d.confirms, surveys: d.surveys,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname, searchParams } = url;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  try {
    /* ---------- 系统 ---------- */
    if (pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        llmEnabled: config.LLM_ENABLED,
        model: config.LLM_ENABLED ? config.LLM_MODEL : null,
        corpusSize: corpus.length,
        quizCategories: quiz.length,
        companyName: (db.load().settings || {}).companyName || '',
      });
    }

    // 运行时配置大模型密钥（页面"粘贴密钥立即生效"）
    if (pathname === '/api/config-key' && req.method === 'POST') {
      const b = await readBody(req);
      setRuntimeKey({
        apiKey: (b.apiKey || '').trim(),
        baseUrl: (b.baseUrl || '').trim(),
        model: (b.model || '').trim(),
      });
      db.log('配置大模型', b.apiKey ? '已更新 API Key' : '清空 API Key');
      return sendJson(res, 200, { ok: true, llmEnabled: config.LLM_ENABLED, model: config.LLM_MODEL });
    }

    if (pathname === '/api/settings') {
      if (req.method === 'PUT') {
        const b = await readBody(req);
        const s = db.load().settings || {};
        Object.keys(b).forEach((k) => (s[k] = b[k]));
        db.save();
        db.log('修改系统设置', Object.keys(b).join(','));
        return sendJson(res, 200, s);
      }
      return sendJson(res, 200, db.load().settings || {});
    }

    if (pathname === '/api/reset' && req.method === 'POST') {
      db.reset();
      return sendJson(res, 200, { ok: true });
    }

    /* ---------- 统计（首页工作台） ---------- */
    if (pathname === '/api/stats') {
      const d = db.load();
      const items = scan(snapshot());
      const high = items.filter((i) => i.sev === '高').length;
      const people = items.reduce((s, i) => s + (i.people || []).length, 0);
      return sendJson(res, 200, {
        employees: d.employees.filter((e) => e.status !== 'left').length,
        left: d.employees.filter((e) => e.status === 'left').length,
        contracts: d.contracts.length,
        certs: d.certs.length,
        risks: items.length,
        high,
        people,
        todo: d.riskItems.filter((x) => x.todoStatus !== 'done').length,
      });
    }

    /* ---------- 风险扫描 ---------- */
    if (pathname === '/api/scan') {
      const items = scan(snapshot());
      return sendJson(res, 200, { items, at: Date.now() });
    }

    if (pathname === '/api/quiz') {
      return sendJson(res, 200, { categories: quiz });
    }

    /* ---------- 规则库与启停 ---------- */
    if (pathname === '/api/rules') {
      const d = db.load();
      const { RULES } = require('./src/engine');
      return sendJson(res, 200, {
        rules: RULES.map((r) => ({
          ...r,
          enabled: d.ruleCfg[r.id] && d.ruleCfg[r.id].enabled !== undefined ? d.ruleCfg[r.id].enabled : r.enabled,
        })),
      });
    }

    if (pathname.startsWith('/api/rules/') && req.method === 'PUT') {
      const id = decodeURIComponent(pathname.slice('/api/rules/'.length));
      const b = await readBody(req);
      const d = db.load();
      d.ruleCfg[id] = Object.assign({}, d.ruleCfg[id], { enabled: !!b.enabled });
      db.save();
      db.log('规则启停', `${id} → ${b.enabled ? '启用' : '停用'}`);
      return sendJson(res, 200, { ok: true, id, enabled: !!b.enabled });
    }

    /* ---------- 法务确认台账 / 问卷 ---------- */
    if (pathname === '/api/confirm' && req.method === 'POST') {
      const b = await readBody(req);
      const d = db.load();
      d.confirms[b.ruleId] = {
        ruleId: b.ruleId, answer: b.answer, note: b.note || '',
        by: b.by || '法务', at: Date.now(),
      };
      db.save();
      db.log('法务确认', `${b.ruleId} → ${b.answer}`);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/survey' && req.method === 'POST') {
      const b = await readBody(req);
      const d = db.load();
      Object.keys(b.answers || {}).forEach((rid) => {
        d.surveys[rid] = { ruleId: rid, answer: b.answers[rid], by: '问卷', at: Date.now() };
      });
      db.save();
      db.log('提交自检问卷', `${Object.keys(b.answers || {}).length} 题`);
      return sendJson(res, 200, { ok: true });
    }

    /* ---------- 风险处置：派发 / 更新 ---------- */
    if (pathname === '/api/dispatch' && req.method === 'POST') {
      const b = await readBody(req);
      const d = db.load();
      const exist = d.riskItems.filter((x) => x.ruleId === b.ruleId && x.todoStatus !== 'done');
      if (exist.length) return sendJson(res, 200, { ok: true, duplicated: true, item: exist[0] });
      const item = db.add('riskItems', {
        ruleId: b.ruleId, risk: b.risk || '', owner: b.owner || 'hr',
        assignee: b.assignee || '', dueDate: b.dueDate || '',
        todoStatus: 'pending', note: b.note || '',
      });
      db.log('派发风险处置', `${b.ruleId} → ${b.owner || 'hr'}`);
      return sendJson(res, 200, { ok: true, item });
    }

    /* ---------- AI ---------- */
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

    /* ---------- 导入导出 ---------- */
    if (pathname === '/api/export') {
      return sendJson(res, 200, db.load());
    }

    if (pathname === '/api/import' && req.method === 'POST') {
      const b = await readBody(req);
      const cur = db.load();
      let n = 0;
      COLLECTIONS.forEach((c) => {
        if (Array.isArray(b[c])) {
          cur[c] = b[c];
          n += b[c].length;
        }
      });
      if (b.settings && typeof b.settings === 'object') {
        cur.settings = Object.assign({}, cur.settings, b.settings);
      }
      db.save();
      db.log('导入数据', `${n} 条`);
      return sendJson(res, 200, { ok: true, imported: n });
    }

    /* ---------- 通用 CRUD：/api/c/:name[/:id] ---------- */
    const m = pathname.match(/^\/api\/c\/([A-Za-z]+)(?:\/([^/]+))?$/);
    if (m) {
      const name = m[1];
      const id = m[2] ? decodeURIComponent(m[2]) : null;
      if (!COLLECTIONS.includes(name)) return sendJson(res, 400, { error: '未知集合：' + name });

      if (req.method === 'GET') {
        if (id) return sendJson(res, 200, db.get(name, id) || {});
        const filter = {};
        ['employeeId', 'status', 'type', 'todoStatus', 'role'].forEach((k) => {
          if (searchParams.get(k)) filter[k] = searchParams.get(k);
        });
        return sendJson(res, 200, { items: db.list(name, filter) });
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        const obj = db.add(name, b);
        db.log('新增', `${name}:${obj._id}`);
        return sendJson(res, 200, obj);
      }
      if (req.method === 'PUT' && id) {
        const b = await readBody(req);
        const obj = db.update(name, id, b);
        if (!obj) return sendJson(res, 404, { error: '记录不存在' });
        db.log('修改', `${name}:${id}`);
        return sendJson(res, 200, obj);
      }
      if (req.method === 'DELETE' && id) {
        const ok = db.remove(name, id);
        db.log('删除', `${name}:${id}`);
        return sendJson(res, 200, { ok });
      }
    }

    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: '未知接口' });
    return serveStatic(req, res, pathname);
  } catch (e) {
    return sendJson(res, 500, { error: String(e && e.message ? e.message : e) });
  }
});

server.listen(PORT, () => {
  console.log('===============================================');
  console.log(' 用工管家 AI Agent（网页版）已启动');
  console.log(` 访问地址： http://localhost:${PORT}`);
  console.log(` 知识库：   ${corpus.length} 条 · 规则 116 条 · 自检 ${quiz.length} 环节`);
  console.log(
    ` AI 模式：  ${config.LLM_ENABLED ? '真实大模型已接入（' + config.LLM_MODEL + '）' : '未配置密钥 → 本地规则引擎兜底（可在页面系统设置里粘贴密钥，立即生效）'}`
  );
  console.log('===============================================');
});
