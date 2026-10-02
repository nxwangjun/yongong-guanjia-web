/**
 * 小哲用工风险检测系统 —— Web 服务端
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
const auth = require('./src/auth');
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
  'confirms', 'surveys', 'riskItems',
  'users', 'members', 'invites', 'audit', 'tenants', 'accounts',
];

// 集合 → 所属模块（用于模块级权限校验）
const COL2MOD = {
  employees: 'staff', contracts: 'contract', attendances: 'attend',
  payrolls: 'payroll', socials: 'social', certs: 'cert',
  riskItems: 'risktodo',
  invites: 'member', users: 'member', accounts: 'member', tenants: 'setting', audit: 'setting',
};

// 导出到 Excel 的字段（k=字段名，t=中文表头，d=日期字段）
const EXPORT_FIELDS = {
  employees: [
    { k: 'name', t: '姓名' }, { k: 'empNo', t: '工号' }, { k: 'dept', t: '部门' },
    { k: 'entryDate', t: '入职日期', d: 1 }, { k: 'status', t: '在职状态' },
  ],
  contracts: [
    { k: 'employeeId', t: '员工ID' }, { k: 'type', t: '合同类型' },
    { k: 'months', t: '期限(月)' }, { k: 'probationMonths', t: '试用期(月)' },
    { k: 'signDate', t: '签订日期', d: 1 }, { k: 'endDate', t: '到期日期', d: 1 },
  ],
  attendances: [
    { k: 'employeeId', t: '员工ID' }, { k: 'month', t: '月份' },
    { k: 'overtimeHours', t: '加班小时' }, { k: 'hours', t: '出勤小时' },
  ],
  payrolls: [
    { k: 'employeeId', t: '员工ID' }, { k: 'month', t: '月份' }, { k: 'amount', t: '月工资' },
    { k: 'overtimePay', t: '加班费' }, { k: 'probation', t: '试用期工资' },
    { k: 'formalAmount', t: '转正工资' },
  ],
  socials: [
    { k: 'employeeId', t: '员工ID' }, { k: 'insured', t: '已参保' }, { k: 'base', t: '缴纳基数' },
  ],
  certs: [
    { k: 'employeeId', t: '员工ID' }, { k: 'name', t: '证照名称' },
    { k: 'no', t: '证书编号' }, { k: 'expireDate', t: '有效期至', d: 1 },
  ],
  riskItems: [
    { k: 'ruleId', t: '规则号' }, { k: 'risk', t: '风险点' }, { k: 'owner', t: '归口' },
    { k: 'assignee', t: '责任人' }, { k: 'dueDate', t: '期限', d: 1 }, { k: 'todoStatus', t: '状态' },
  ],
};

// Excel 表名 ↔ 集合名
const SHEET_LABEL = {
  employees: '员工', contracts: '劳动合同', attendances: '考勤', payrolls: '薪资',
  socials: '社保', certs: '证照', riskItems: '风险处置',
};
const SHEET2COL = {};
Object.keys(SHEET_LABEL).forEach((k) => {
  SHEET2COL[SHEET_LABEL[k]] = k;
});

// 无需登录即可访问的接口
const PUBLIC_API = ['/api/health'];

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

/** 读原始二进制请求体（用于上传 Excel / CSV） */
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts)));
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

/** 组装扫描所需的完整数据快照（按登录者所在公司隔离） */
function snapshot(sess) {
  const d = db.load();
  const pick = (arr) => auth.byTenant(arr || [], sess);
  return {
    employees: pick(d.employees), contracts: pick(d.contracts),
    attendances: pick(d.attendances), payrolls: pick(d.payrolls),
    socials: pick(d.socials), certs: pick(d.certs),
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
    /* ---------- 登录态 ---------- */
    const isAuthApi = pathname.startsWith('/api/auth/');
    const token =
      (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
      searchParams.get('token') || '';
    const sess = auth.session(token);

    if (pathname.startsWith('/api/') && !isAuthApi && !PUBLIC_API.includes(pathname) && !sess) {
      return sendJson(res, 401, { error: '未登录或登录已过期', needLogin: true });
    }

    /* ---------- 账号 ---------- */
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const b = await readBody(req);
      try {
        return sendJson(res, 200, auth.registerAdmin(b));
      } catch (e) {
        return sendJson(res, 400, { error: e.message });
      }
    }
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const b = await readBody(req);
      try {
        return sendJson(res, 200, auth.login(b));
      } catch (e) {
        return sendJson(res, 400, { error: e.message });
      }
    }
    if (pathname === '/api/auth/join' && req.method === 'POST') {
      const b = await readBody(req);
      try {
        return sendJson(res, 200, auth.join(b));
      } catch (e) {
        return sendJson(res, 400, { error: e.message });
      }
    }
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      auth.logout(token);
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/auth/me') {
      const u = db.list('accounts').filter((a) => a._id === sess.userId)[0] || {};
      return sendJson(res, 200, {
        user: auth.publicUser(u),
        scope: auth.scopeOf(sess.role),
      });
    }

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

    /* ---------- 地区用工环境（最低工资） ---------- */
    if (pathname === '/api/regions') {
      const region = require('./src/region');
      return sendJson(res, 200, {
        updated: region.DATA_UPDATED || '',
        regions: region.names().map((n) => region.profileOf(n)),
      });
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
      const items = scan(snapshot(sess));
      const high = items.filter((i) => i.sev === '高').length;
      const people = items.reduce((s, i) => s + (i.people || []).length, 0);
      const myRiskItems = auth.byTenant(d.riskItems || [], sess);
      const myEmployees = auth.byTenant(d.employees || [], sess);
      return sendJson(res, 200, {
        employees: myEmployees.filter((e) => e.status !== 'left').length,
        left: myEmployees.filter((e) => e.status === 'left').length,
        contracts: auth.byTenant(d.contracts || [], sess).length,
        certs: auth.byTenant(d.certs || [], sess).length,
        risks: items.length,
        high,
        people,
        todo: myRiskItems.filter((x) => x.todoStatus !== 'done').length,
      });
    }

    /* ---------- 风险扫描 ---------- */
    if (pathname === '/api/scan') {
      const items = scan(snapshot(sess));
      return sendJson(res, 200, { items, at: Date.now() });
    }

    /* ---------- 按员工维度聚合风险（核心价值：每个人的用工风险画像） ---------- */
    if (pathname === '/api/risk/by-employee') {
      const d = db.load();
      const items = scan(snapshot(sess));
      const emps = auth.byTenant(d.employees || [], sess);
      const out = emps.map((e) => {
        const risks = [];
        items.forEach((it) => {
          (it.people || []).forEach((p) => {
            if (p.employeeId === e._id) {
              risks.push({
                ruleId: it.ruleId, risk: it.risk, sev: it.sev, detail: p.detail,
                catLabel: it.catLabel, law: it.law,
                consequence: it.consequence, remedy: it.remedy,
              });
            }
          });
        });
        return {
          _id: e._id, name: e.name, dept: e.dept || '', status: e.status || 'on',
          entryDate: e.entryDate, empNo: e.empNo || '',
          riskCount: risks.length,
          highCount: risks.filter((r) => r.sev === '高').length,
          risks,
        };
      });
      // 风险多的排前面
      out.sort((a, b) => b.highCount - a.highCount || b.riskCount - a.riskCount);
      return sendJson(res, 200, { employees: out, at: Date.now() });
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
        ruleId: b.ruleId, risk: b.risk || '', owner: b.owner || 'admin',
        assignee: b.assignee || '', dueDate: b.dueDate || '',
        todoStatus: 'pending', note: b.note || '',
        tenantId: sess ? sess.tenantId : '',
      });
      db.log('派发风险处置', `${b.ruleId} → ${b.owner || 'admin'}`);
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

    /* ---------- 导出 Excel ---------- */
    if (pathname === '/api/export.xlsx') {
      const xlsx = require('./src/xlsx');
      const d = db.load();
      const sheets = [];
      Object.keys(EXPORT_FIELDS).forEach((col) => {
        const spec = EXPORT_FIELDS[col];
        const items = auth.byTenant(d[col] || [], sess);
        const rows = [spec.map((f) => f.t)];
        items.forEach((it) =>
          rows.push(
            spec.map((f) => {
              const v = it[f.k];
              if (f.d) return v ? new Date(Number(v)).toISOString().slice(0, 10) : '';
              if (typeof v === 'boolean') return v ? '是' : '否';
              return v === undefined || v === null ? '' : v;
            })
          )
        );
        sheets.push({ name: SHEET_LABEL[col] || col, rows });
      });
      const buf = xlsx.buildXlsx(sheets);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="yongong-' + new Date().toISOString().slice(0, 10) + '.xlsx"',
        'Content-Length': buf.length,
      });
      return res.end(buf);
    }

    /* ---------- 导出 CSV（单个集合） ---------- */
    if (pathname === '/api/export.csv') {
      const xlsx = require('./src/xlsx');
      const col = searchParams.get('col') || 'employees';
      const spec = EXPORT_FIELDS[col];
      if (!spec) return sendJson(res, 400, { error: '不支持的集合：' + col });
      const d = db.load();
      const items = auth.byTenant(d[col] || [], sess);
      const rows = [spec.map((f) => f.t)];
      items.forEach((it) =>
        rows.push(
          spec.map((f) => {
            const v = it[f.k];
            if (f.d) return v ? new Date(Number(v)).toISOString().slice(0, 10) : '';
            if (typeof v === 'boolean') return v ? '是' : '否';
            return v === undefined || v === null ? '' : v;
          })
        )
      );
      const text = '\uFEFF' + xlsx.rowsToCsv(rows); // BOM：Excel/WPS 打开不乱码
      const body = Buffer.from(text, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + col + '.csv"',
        'Content-Length': body.length,
      });
      return res.end(body);
    }

    /* ---------- 上传文件导入（xlsx / csv） ---------- */
    if (pathname === '/api/import/file' && req.method === 'POST') {
      const xlsx = require('./src/xlsx');
      const type = (searchParams.get('type') || '').toLowerCase();
      const raw = await readRaw(req);
      const cur = db.load();
      let imported = 0;
      const detail = [];

      function writeCol(col, rows) {
        const spec = EXPORT_FIELDS[col];
        if (!spec || !rows.length) return;
        const header = rows[0].map((h) => String(h).trim());
        const idx = spec.map((f) => header.indexOf(f.t));
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !r.some((x) => String(x || '').trim() !== '')) continue;
          const obj = { tenantId: sess ? sess.tenantId : '' };
          spec.forEach((f, fi) => {
            const j = idx[fi];
            if (j < 0) return;
            let v = r[j];
            if (f.d) {
              const t = v ? new Date(String(v) + 'T00:00:00').getTime() : 0;
              obj[f.k] = isNaN(t) ? 0 : t;
            } else if (typeof v === 'string' && /^\d+$/.test(v) && f.k !== 'empNo' && f.k !== 'no') {
              obj[f.k] = Number(v);
            } else {
              obj[f.k] = v;
            }
          });
          // 布尔字段：Excel 里写「是/否」
          if (obj.insured !== undefined) obj.insured = /是|true|1|yes/i.test(String(obj.insured));
          if (obj.probation !== undefined) obj.probation = /是|true|1|yes/i.test(String(obj.probation));
          db.add(col, obj);
          imported++;
        }
        detail.push(col + '：' + (rows.length - 1) + ' 行');
      }

      if (type === 'xlsx') {
        const sheets = xlsx.parseXlsx(raw);
        sheets.forEach((sh) => {
          const col = SHEET2COL[sh.name];
          if (col) writeCol(col, sh.rows);
        });
        if (!imported) return sendJson(res, 400, { error: '未识别到可导入的工作表（表头需为导出时的中文表头）' });
      } else if (type === 'csv') {
        const col = searchParams.get('col') || 'employees';
        const rows = xlsx.csvToRows(raw.toString('utf8'));
        writeCol(col, rows);
      } else {
        return sendJson(res, 400, { error: '不支持的文件类型：' + type });
      }

      db.save();
      db.log('导入文件', `${type}：${imported} 条`, sess ? sess.name : '系统');
      return sendJson(res, 200, { ok: true, imported, detail });
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

      // 模块级权限（管理员恒通过；防止绕过前端直接调接口）
      const mod = COL2MOD[name];
      if (mod && sess && !auth.canModule(sess.role, mod)) {
        return sendJson(res, 403, { error: '当前角色无此模块权限' });
      }

      if (req.method === 'GET') {
        if (id) return sendJson(res, 200, db.get(name, id) || {});
        const filter = {};
        ['employeeId', 'status', 'type', 'todoStatus', 'role'].forEach((k) => {
          if (searchParams.get(k)) filter[k] = searchParams.get(k);
        });
        let items = db.list(name, filter);
        items = auth.byTenant(items, sess);            // 公司隔离
        return sendJson(res, 200, { items });
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (sess) b.tenantId = sess.tenantId;
        const obj = db.add(name, b);
        db.log('新增', `${name}:${obj._id}`, sess ? sess.name : '系统');
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
  console.log(' 小哲用工风险检测系统（网页版）已启动');
  console.log(` 访问地址： http://localhost:${PORT}`);
  console.log(` 知识库：   ${corpus.length} 条 · 规则 116 条 · 自检 ${quiz.length} 环节`);
  console.log(
    ` AI 模式：  ${config.LLM_ENABLED ? '真实大模型已接入（' + config.LLM_MODEL + '）' : '未配置密钥 → 本地规则引擎兜底（可在页面系统设置里粘贴密钥，立即生效）'}`
  );
  console.log('===============================================');
});
