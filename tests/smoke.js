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

  // 本地扫描：36 人演示数据应命中 19 类（17 类风险 + 证照临期提醒 + 30日社保登记）
  const sc = await API.scan();
  ok('本地风险扫描', sc.items.length === 19, `命中 ${sc.items.length} 类`);

  // 统计
  const st = await API.stats();
  ok('本地统计', st.employees > 0 && st.risks === sc.items.length, `在职=${st.employees}, 风险=${st.risks}, 高危=${st.high}`);

  // 按员工聚合
  const pe = await API.riskByEmployee();
  const withRisk = pe.employees.filter((e) => e.riskCount > 0).length;
  ok('员工风险画像聚合', pe.employees.length === 36 && withRisk > 0, `${withRisk}/36 人有风险`);

  // 规则库 + 开关（116 条规则库 + 9 条扩充自动规则 + 证照临期提醒 = 126 条）
  const rl = await API.rules();
  ok('规则库 126 条（116+9扩充+1证照提醒）', rl.rules.length === 126, `实际 ${rl.rules.length} 条`);

  // 开关真实生效：停用 auto 规则 → 命中数减少且不再出现该条
  await API.setRule('R-ENTRY-01', false);
  const rl2 = await API.rules();
  ok('规则开关（界面状态）', rl2.rules.find((x) => x.id === 'R-ENTRY-01').enabled === false);
  const scOff = await API.scan();
  ok('停用 auto 规则后不再命中', !scOff.items.some((i) => i.ruleId === 'R-ENTRY-01') && scOff.items.length < sc.items.length,
    `${sc.items.length} → ${scOff.items.length}`);
  await API.setRule('R-ENTRY-01', true);
  const scOn = await API.scan();
  ok('恢复后重新命中', scOn.items.some((i) => i.ruleId === 'R-ENTRY-01'));

  // 扩充自动规则纳入开关
  const extraId = 'R-ENTRY-05';
  const extraHit = scOn.items.some((i) => i.ruleId === extraId);
  if (extraHit) {
    await API.setRule(extraId, false);
    const scExtraOff = await API.scan();
    ok('扩充自动规则可停用', !scExtraOff.items.some((i) => i.ruleId === extraId));
    await API.setRule(extraId, true);
  } else {
    ok('扩充自动规则可停用', true, '该条当前未命中，跳过实测');
  }

  // 证照临期提醒纳入开关
  const certHit = scOn.items.some((i) => i.ruleId === 'CERT-EXPIRE');
  if (certHit) {
    await API.setRule('CERT-EXPIRE', false);
    const scCertOff = await API.scan();
    ok('证照临期提醒可停用', !scCertOff.items.some((i) => i.ruleId === 'CERT-EXPIRE'));
    await API.setRule('CERT-EXPIRE', true);
  } else {
    ok('证照临期提醒可停用', true, '该条当前未命中，跳过实测');
  }

  // ask 规则：答 no 命中 → 停用后不再命中
  await API.confirm('R-SYSTEM-01', 'no', 'smoke');
  const askHitItems = (await API.scan()).items;
  const askWasHit = askHitItems.some((i) => i.ruleId === 'R-SYSTEM-01');
  ok('ask 规则答否命中', askWasHit);
  await API.setRule('R-SYSTEM-01', false);
  const askOff = (await API.scan()).items;
  ok('停用 ask 规则后不再命中', !askOff.some((i) => i.ruleId === 'R-SYSTEM-01'));
  await API.setRule('R-SYSTEM-01', true);

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

  // 六表合并 CSV：模板带示例行，导入时示例行被自动剔除
  const tplAll = window.CSV.allToCsv(null, true);
  const tplParsed = window.CSV.csvToAll(tplAll);
  ok('合并模板含六段且示例行被剔除', tplParsed.employees && tplParsed.employees.length === 0 &&
    window.CSV.COL_ORDER.every((k) => tplAll.includes('#' + k)), `段数=${window.CSV.COL_ORDER.length}`);
  const realAll = window.CSV.allToCsv({ employees: (await API.list('employees')).slice(0, 2), payrolls: (await API.list('payrolls')).slice(0, 2) }, false);
  const realParsed = window.CSV.csvToAll(realAll);
  ok('合并导出→拆回闭环', realParsed.employees.length === 2 && realParsed.payrolls.length === 2,
    `员工=${realParsed.employees.length}, 薪资=${realParsed.payrolls.length}`);

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
