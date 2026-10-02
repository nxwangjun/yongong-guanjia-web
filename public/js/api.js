/**
 * 前端数据层（A1 方案：纯浏览器 localStorage 版）
 *
 * 核心设计：
 *   - 所有业务数据存浏览器 localStorage 单键 'yg_db'（完整快照，形状 = src/db.js seed() 返回的对象）
 *   - 风险扫描在浏览器里直接跑（window.Engine.scan，规则库内嵌在 data-bundle.js）
 *   - 数据不出浏览器、不上传服务器；评委/用户之间互不干扰
 *   - AI 接口（explain/chat/diagnose）仍走服务器代理（密钥不能下发浏览器）
 *
 * 首次打开自动载入 36 人演示数据（window.getSeed）。
 */
const API = (() => {
  const LS_KEY = 'yg_db';
  /* ---------- 快照读写 ---------- */
  function loadDb() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d === 'object' && Array.isArray(d.employees)) return d;
      }
    } catch (e) { /* 数据损坏时回落到演示数据 */ }
    const s = window.getSeed();
    saveDb(s);
    return s;
  }

  function saveDb(d) {
    localStorage.setItem(LS_KEY, JSON.stringify(d));
  }

  function genId(prefix) {
    return (prefix || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function log(d, action, detail) {
    d.audit = d.audit || [];
    d.audit.unshift({ _id: genId('au'), action, detail, who: '本机', at: Date.now() });
    if (d.audit.length > 500) d.audit.length = 500;
  }

  /* ---------- 通用集合 ---------- */
  async function list(col, filter = {}) {
    const d = loadDb();
    let v = d[col];
    // confirms / surveys 在库里是 { ruleId: {...} } 字典，转成数组方便页面使用
    let items = Array.isArray(v) ? v.slice() : Object.values(v || {});
    Object.keys(filter).forEach((k) => {
      items = items.filter((it) => String(it[k]) === String(filter[k]));
    });
    return items;
  }

  async function add(col, obj) {
    const d = loadDb();
    d[col] = d[col] || [];
    const item = { _id: obj._id || genId(col.slice(0, 2)), ...obj };
    d[col].push(item);
    saveDb(d);
    return item;
  }

  async function update(col, id, patch) {
    const d = loadDb();
    const arr = d[col] || [];
    const it = arr.find((x) => x._id === id);
    if (it) Object.assign(it, patch);
    saveDb(d);
    return it;
  }

  async function remove(col, id) {
    const d = loadDb();
    d[col] = (d[col] || []).filter((x) => x._id !== id);
    saveDb(d);
    return { ok: true };
  }

  /* ---------- 扫描与统计（浏览器直跑引擎） ---------- */
  async function scan() {
    const items = window.Engine.scan(loadDb());
    return { items, at: Date.now() };
  }

  async function stats() {
    const d = loadDb();
    const items = window.Engine.scan(d);
    const high = items.filter((i) => i.sev === '高').length;
    const people = items.reduce((s, i) => s + (i.people || []).length, 0);
    return {
      employees: (d.employees || []).filter((e) => e.status !== 'left').length,
      left: (d.employees || []).filter((e) => e.status === 'left').length,
      contracts: (d.contracts || []).length,
      certs: (d.certs || []).length,
      risks: items.length,
      high,
      people,
      todo: (d.riskItems || []).filter((x) => x.todoStatus !== 'done').length,
    };
  }

  async function riskByEmployee() {
    const d = loadDb();
    const items = window.Engine.scan(d);
    const emps = d.employees || [];
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
    out.sort((a, b) => b.highCount - a.highCount || b.riskCount - a.riskCount);
    return { employees: out, at: Date.now() };
  }

  /* ---------- 规则与问卷 ---------- */
  async function rules() {
    const d = loadDb();
    const disabled = (d.settings && d.settings.disabledRules) || [];
    // 116 条规则库 + 扩充自动规则 + 证照临期提醒，统一展示与开关
    const all = (window.Engine.RULES || []).concat(window.Engine.EXTRA_RULE_LIST || []);
    return { rules: all.map((r) => ({ ...r, enabled: !disabled.includes(r.id) })) };
  }

  async function setRule(id, enabled) {
    const d = loadDb();
    d.settings = d.settings || {};
    const dis = new Set(d.settings.disabledRules || []);
    if (enabled) dis.delete(id); else dis.add(id);
    d.settings.disabledRules = [...dis];
    saveDb(d);
    return { ok: true };
  }

  async function quiz() {
    return { categories: window.QUIZ_DATA };
  }

  async function confirm(ruleId, answer, note) {
    const d = loadDb();
    // 兼容种子数据里 confirms 是数组的情况：统一成 { ruleId: {...} } 字典
    if (Array.isArray(d.confirms)) {
      const m = {};
      d.confirms.forEach((x) => { if (x && x.ruleId) m[x.ruleId] = x; });
      d.confirms = m;
    }
    d.confirms = d.confirms || {};
    d.confirms[ruleId] = { ruleId, answer, note: note || '', by: '法务', at: Date.now() };
    log(d, '法务确认', `${ruleId} → ${answer}`);
    saveDb(d);
    return { ok: true };
  }

  async function survey(answers) {
    const d = loadDb();
    if (Array.isArray(d.surveys)) {
      const m = {};
      d.surveys.forEach((x) => { if (x && x.ruleId) m[x.ruleId] = x; });
      d.surveys = m;
    }
    d.surveys = d.surveys || {};
    Object.keys(answers || {}).forEach((rid) => {
      d.surveys[rid] = { ruleId: rid, answer: answers[rid], by: '问卷', at: Date.now() };
    });
    log(d, '提交自检问卷', `${Object.keys(answers || {}).length} 题`);
    saveDb(d);
    return { ok: true };
  }

  async function dispatch(payload) {
    const d = loadDb();
    d.riskItems = d.riskItems || [];
    const exist = d.riskItems.filter((x) => x.ruleId === payload.ruleId && x.todoStatus !== 'done');
    if (exist.length) return { ok: true, duplicated: true, item: exist[0] };
    const item = {
      _id: genId('ri'),
      ruleId: payload.ruleId, risk: payload.risk || '', owner: payload.owner || 'admin',
      assignee: payload.assignee || '', dueDate: payload.dueDate || '',
      todoStatus: 'pending', note: payload.note || '',
    };
    d.riskItems.push(item);
    log(d, '派发风险处置', `${payload.ruleId} → ${item.owner}`);
    saveDb(d);
    return { ok: true, item };
  }

  /* ---------- 设置 ---------- */
  async function settings() {
    return { settings: loadDb().settings || {} };
  }

  async function saveSettings(obj) {
    const d = loadDb();
    d.settings = { ...(d.settings || {}), ...obj };
    log(d, '修改系统设置', Object.keys(obj).join('、'));
    saveDb(d);
    return { ok: true };
  }

  /* ---------- 备份 / 恢复 / 重置（纯前端） ---------- */
  async function exportAll() {
    return loadDb();
  }

  async function importAll(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.employees)) {
      throw new Error('备份文件格式不对：缺少 employees 数组');
    }
    saveDb(data);
    return { ok: true };
  }

  async function reset() {
    const s = window.getSeed();
    saveDb(s);
    return { ok: true };
  }

  async function clearAll() {
    localStorage.removeItem(LS_KEY);
    return { ok: true };
  }

  /* ---------- AI 与服务器接口（密钥留在服务端，必须走 HTTP） ---------- */
  async function req(method, path, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    const r = await fetch(path, opt);
    const t = await r.text();
    let j;
    try { j = JSON.parse(t); } catch (e) { throw new Error('返回不是 JSON：' + t.slice(0, 120)); }
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }

  /* 兼容少数页面还在用的老接口形状（本地实现，不走网络） */
  const LOCAL_GET = {
    '/api/risk/by-employee': riskByEmployee,
    '/api/stats': stats,
    '/api/scan': scan,
    '/api/quiz': quiz,
    '/api/rules': rules,
    '/api/settings': settings,
    '/api/export': exportAll,
    '/api/regions': async () => ({
      updated: window.Engine.Region.DATA_UPDATED || '',
      regions: window.Engine.Region.names().map((n) => window.Engine.Region.profileOf(n)),
    }),
  };

  function get(p) {
    const clean = p.split('?')[0];
    if (LOCAL_GET[clean]) return LOCAL_GET[clean]();
    return req('GET', p);
  }

  return {
    get,
    post: (p, b) => req('POST', p, b),

    list, add, update, remove,
    health: () => req('GET', '/api/health'),
    stats, scan, riskByEmployee,
    quiz, rules, setRule, confirm, survey, dispatch,
    settings, saveSettings,
    exportAll, importAll, reset, clearAll,

    explain: (item) => req('POST', '/api/ai/explain', { item }),
    chat: (question, history) => req('POST', '/api/ai/chat', { question, history }),
    diagnose: (meta, answers) => req('POST', '/api/diagnose', { meta, answers }),
    configKey: (o) => req('POST', '/api/config-key', o),
  };
})();

/* 显式挂全局：浏览器里顶层 const 本就在全局词法环境可直接用，
   显式挂 window 是为了 Node 测试桩（require 时 const 不挂 global）也能用 */
if (typeof window !== 'undefined') window.API = API;
