/**
 * 端到端冒烟（A1 免登录版）：
 *   1) 服务器只保留 静态 + /api/health + /api/ai/* + /api/config-key
 *   2) 业务数据链路改在浏览器直跑，这里用「window + localStorage 桩」模拟浏览器环境，
 *      加载 data-bundle / seed / engine-browser / api.js 跑完整业务链路
 * 跑法：先 node server.js（后台），再 node tests/smoke.js
 */
const path = require('path');
const BASE = 'http://localhost:3000';

async function hit(method, path, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + path, opt);
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch (e) {}
  return { status: r.status, json: j, text: t };
}

const checks = [];
const ok = (name, cond, extra) => {
  checks.push({ name, pass: !!cond });
  console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? ' → ' + extra : ''));
};

(async () => {
  /* ============ 一、服务器侧（静态 + AI 代理 + health） ============ */
  let r = await hit('GET', '/api/health');
  ok('健康检查', r.status === 200 && r.json && r.json.ok, `llm=${r.json && r.json.llmEnabled}, 语料=${r.json && r.json.corpusSize}`);

  r = await hit('GET', '/');
  ok('首页静态页', r.status === 200 && (r.text.includes('小哲') || r.text.includes('用工风险检测')));

  for (const f of ['data-bundle.js', 'seed.js', 'engine-browser.js', 'csv.js', 'api.js', 'app.js']) {
    r = await hit('GET', '/js/' + f);
    ok('前端资源 ' + f, r.status === 200);
  }

  r = await hit('GET', '/js/pages/login.js');
  ok('登录页脚本已移除', r.status === 404);

  r = await hit('GET', '/api/stats');
  ok('旧业务接口已下线（410）', r.status === 410);

  r = await hit('POST', '/api/ai/chat', { question: '试用期最长能约定多久？', history: [] });
  ok('AI 问答', r.status === 200 && r.json && ['llm', 'local'].includes(r.json.mode), `mode=${r.json && r.json.mode}`);
  if (r.json && r.json.mode === 'llm') console.log('   回答片段：' + String(r.json.answer).slice(0, 90).replace(/\n/g, ' '));
  else console.log('   ⚠ 未配置密钥，走本地规则引擎兜底');

  /* ============ 二、浏览器侧（window + localStorage 桩模拟） ============ */
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  global.window = global;

  const P = (f) => path.join(__dirname, '..', 'public', 'js', f);
  require(P('data-bundle.js'));
  require(P('seed.js'));
  require(P('engine-browser.js'));
  require(P('csv.js'));
  require(P('api.js'));

  // 首次打开自动种入演示数据
  const d0 = await API.exportAll();
  ok('首次打开自动载入演示数据', d0.employees.length === 36 && d0.contracts.length === 34,
    `员工=${d0.employees.length}, 合同=${d0.contracts.length}`);

  // 本地扫描：36 人演示数据应命中 18 类（17 类风险 + 证照临期提醒）
  const sc = await API.scan();
  ok('本地风险扫描', sc.items.length === 18, `命中 ${sc.items.length} 类`);

  // 统计
  const st = await API.stats();
  ok('本地统计', st.employees > 0 && st.risks === sc.items.length, `在职=${st.employees}, 风险=${st.risks}, 高危=${st.high}`);

  // 按员工聚合
  const pe = await API.riskByEmployee();
  const withRisk = pe.employees.filter((e) => e.riskCount > 0).length;
  ok('员工风险画像聚合', pe.employees.length === 36 && withRisk > 0, `${withRisk}/36 人有风险`);

  // 规则库 + 开关
  const rl = await API.rules();
  ok('规则库 116 条', rl.rules.length === 116);
  await API.setRule('R-ENTRY-01', false);
  const rl2 = await API.rules();
  ok('规则开关', rl2.rules.find((x) => x.id === 'R-ENTRY-01').enabled === false);
  await API.setRule('R-ENTRY-01', true);

  // CRUD
  const neo = await API.add('employees', { name: '测试员', dept: '测试部', entryDate: Date.now(), status: 'on' });
  ok('新增员工', !!neo._id, neo._id);
  await API.update('employees', neo._id, { dept: '已改部门' });
  const got = (await API.list('employees')).find((x) => x._id === neo._id);
  ok('修改员工', got && got.dept === '已改部门');
  await API.remove('employees', neo._id);
  ok('删除员工', !(await API.list('employees')).some((x) => x._id === neo._id));

  // 合规自查（确认台账 + 问卷）
  await API.confirm('R-DEMO-01', 'yes', '已核实');
  const conf = await API.list('confirms');
  ok('法务确认台账', conf.some((x) => x.ruleId === 'R-DEMO-01' && x.answer === 'yes'));
  await API.survey({ 'R-DEMO-02': 'no' });
  const surv = await API.list('surveys');
  ok('自检问卷落库', surv.some((x) => x.ruleId === 'R-DEMO-02'));

  // 派发处置（去重逻辑）
  const first = sc.items[0];
  const dp1 = await API.dispatch({ ruleId: first.ruleId, risk: first.risk, owner: 'admin' });
  const dp2 = await API.dispatch({ ruleId: first.ruleId, risk: first.risk, owner: 'admin' });
  ok('派发处置+幂等去重', dp1.ok && dp2.duplicated === true);
  await API.update('riskItems', dp1.item._id, { todoStatus: 'done' });
  const todo = await API.list('riskItems');
  ok('处置状态更新', todo.find((x) => x._id === dp1.item._id).todoStatus === 'done');

  // 设置
  await API.saveSettings({ minWage: 2300 });
  const s2 = await API.settings();
  ok('设置保存', s2.settings.minWage === 2300);

  // 地区（本地内嵌）
  const rg = await API.get('/api/regions');
  ok('地区库（本地内嵌）', rg.regions.length === 31 && rg.regions.find((x) => x.name === '宁夏').first === 2235);

  // CSV 导出→导入 闭环
  const csvText = window.CSV.colToCsv('employees', (await API.list('employees')).slice(0, 3));
  const back = window.CSV.csvToCol('employees', csvText);
  ok('CSV 导出导入闭环', back.length === 3 && back[0].name, `回读 ${back.length} 条`);

  // 清空 → 自动重种；重置 → 演示数据
  await API.clearAll();
  const d1 = await API.exportAll();
  ok('清空后自动重种演示数据', d1.employees.length === 36 && !d1.audit.some((a) => a.action === '法务确认'));
  await API.reset();
  const d2 = await API.exportAll();
  ok('重置为演示数据', d2.employees.length === 36);

  const pass = checks.filter((x) => x.pass).length;
  console.log(`\n===== 通过 ${pass}/${checks.length} =====`);
  process.exit(pass === checks.length ? 0 : 1);
})().catch((e) => {
  console.error('💥 冒烟异常：', e);
  process.exit(1);
});
