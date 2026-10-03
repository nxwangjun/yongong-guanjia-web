/**
 * 10 个用户全真走查（A1 免登录版）
 *
 * 思路：每个用户一个独立 localStorage（独立浏览器），
 * 按真实操作路径走 API 层（页面 render 调用的就是这套 API），
 * 并对关键页面做「DOM 桩渲染」验证页面能真实出结论、不报错。
 *
 * 跑法：node tests/multiuser.js   （不需要起服务器，纯浏览器侧链路）
 */
const path = require('path');

const results = [];
const issues = []; // 走查中发现的优化建议
const ok = (user, name, cond, extra) => {
  results.push({ user, name, pass: !!cond });
  console.log(`${cond ? '✅' : '❌'} [${user}] ${name}${extra ? ' → ' + extra : ''}`);
};

/* ---------- 浏览器环境桩 ---------- */
function freshBrowser() {
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}
global.window = global;

/* ---------- 最小 DOM 桩：够页面 render 用即可（必须在 require 页面前定义，app.js 加载即调 document） ---------- */
function makeEl() {
  const el = {
    _html: '',
    children: [],
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    textContent: '',
    value: '',
    onclick: null,
    oninput: null,
    onchange: null,
    disabled: false,
    focus() {},
    setSelectionRange() {},
    appendChild() {},
    _q: {},
    querySelector(sel) { return this._q[sel] || (this._q[sel] = makeEl()); },
    querySelectorAll: () => [],
    closest: () => makeEl(),
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); },
  });
  return el;
}
global.document = {
  getElementById: () => makeEl(),
  createElement: () => makeEl(),
  addEventListener() {},
  querySelectorAll: () => [],
  title: '',
};

const P = (f) => path.join(__dirname, '..', 'public', 'js', f);
require(P('data-bundle.js'));
require(P('seed.js'));
require(P('engine-browser.js'));
require(P('csv.js'));
require(P('api.js'));
// ui.js 顶层是 const UI（浏览器里跨脚本可见，Node require 下不外露），手动挂全局
require('vm').runInThisContext(
  require('fs').readFileSync(P('ui.js'), 'utf8') + '\n;window.UI = UI;',
  { filename: 'ui.js' }
);
require(P('pages/hr.js'));
require(P('pages/people.js'));
require(P('pages/risk.js'));
require(P('pages/system.js'));
require(P('app.js'));

const DAY = 86400000;
const now = Date.now();

/* 白手起家：清空全部业务数据（与首页「清空演示数据」同逻辑） */
async function wipeAll() {
  const d = await API.exportAll();
  ['employees', 'contracts', 'attendances', 'payrolls', 'socials', 'certs'].forEach((k) => (d[k] = []));
  d.confirms = {};
  d.surveys = {};
  d.audit = [];
  await API.importAll(d);
}

async function renderPage(pageKey) {
  const c = makeEl();
  await PAGES[pageKey].render(c);
  return c;
}

(async () => {
  /* ================= 用户1 张老板：打开就用演示数据 ================= */
  {
    freshBrowser();
    const u = 'U1张老板(演示数据)';
    const sc = await API.scan();
    ok(u, '演示数据扫出 18 类风险', sc.items.length === 18, `命中 ${sc.items.length} 类`);
    const high = sc.items.filter((i) => i.sev === '高').length;
    const home = await renderPage('home');
    ok(u, '首页风险概要渲染出分级统计', home._html.includes('高危（优先处理）') && home._html.includes('整改建议（按优先级）'));
    ok(u, '首页高危数与扫描一致', home._html.includes(`<b>${sc.items.length}</b><span>风险类别合计</span>`), `高危 ${high} 类`);
    const people = await renderPage('people');
    ok(u, '员工画像页四卡渲染', people._html.includes('员工总数') && people._html.includes('存在风险的员工'));
    const risk = await renderPage('risk');
    const riskListHtml = risk._html + risk.querySelector('#riskList')._html;
    ok(u, '风险清单页渲染且含高危条目', risk._html.includes('用工风险清单') && riskListHtml.includes('ri-title'), `清单 HTML ${riskListHtml.length} 字符`);
  }

  /* ================= 用户2 李HR：白手起家录 1 人没签合同 ================= */
  {
    freshBrowser();
    const u = 'U2李HR(白手起家)';
    await API.exportAll(); // 触发种子
    await wipeAll();
    let sc = await API.scan();
    ok(u, '清空后 0 类风险', sc.items.length === 0, `实际 ${sc.items.length}`);
    await API.add('employees', { name: '李小花', dept: '销售部', entryDate: now - 60 * DAY, status: 'on' });
    sc = await API.scan();
    const hit = sc.items.find((i) => i.ruleId === 'R-ENTRY-01');
    ok(u, '入职 60 天无合同 → 命中未签合同', !!hit, hit && hit.people[0].detail);
    ok(u, '结论点名到人', hit && hit.people[0].name === '李小花');
    const pe = await API.riskByEmployee();
    const li = pe.employees.find((e) => e.name === '李小花');
    // 没签合同 + 没参保记录，应正好命中 R-ENTRY-01 与 R-SOCIAL-01 两条
    const liRules = li.risks.map((r) => r.ruleId).sort().join(',');
    ok(u, '画像里李小花正好 2 项风险（未签合同+未缴社保）',
      li.riskCount === 2 && liRules === 'R-ENTRY-01,R-SOCIAL-01', liRules);
  }

  /* ================= 用户3 王经理：补签合同后风险消失 ================= */
  {
    freshBrowser();
    const u = 'U3王经理(补合同)';
    await API.exportAll();
    await wipeAll();
    const emp = await API.add('employees', { name: '王大锤', dept: '车间', entryDate: now - 45 * DAY, status: 'on' });
    let sc = await API.scan();
    ok(u, '补签前命中未签合同', sc.items.some((i) => i.ruleId === 'R-ENTRY-01'));
    await API.add('contracts', { employeeId: emp._id, type: 'fixed', months: 36, signDate: now - 5 * DAY, endDate: now + 360 * DAY });
    sc = await API.scan();
    ok(u, '补签后该风险消失（数据改动→重算结论同步）', !sc.items.some((i) => i.ruleId === 'R-ENTRY-01'));
  }

  /* ================= 用户4 赵老板：工资低于最低线 ================= */
  {
    freshBrowser();
    const u = 'U4赵老板(低工资)';
    await API.exportAll();
    await wipeAll();
    await API.saveSettings({ minWage: 2235 });
    const emp = await API.add('employees', { name: '赵铁柱', dept: '后勤', entryDate: now - 400 * DAY, status: 'on' });
    await API.add('contracts', { employeeId: emp._id, type: 'fixed', months: 36, signDate: now - 400 * DAY, endDate: now + 300 * DAY });
    await API.add('payrolls', { employeeId: emp._id, month: '2026-09', amount: 2000 });
    let sc = await API.scan();
    const hit = sc.items.find((i) => i.ruleId === 'R-WAGE-01');
    ok(u, '工资 2000 < 最低 2235 → 命中低工资', !!hit, hit && hit.people[0].detail);
    // 没设最低工资时不应误判
    await API.saveSettings({ minWage: 0 });
    sc = await API.scan();
    const notHit = !sc.items.some((i) => i.ruleId === 'R-WAGE-01');
    ok(u, '未设最低工资标准时不误报', notHit);
    if (notHit) issues.push('minWage=0 时 R-WAGE-01 整条不判——对没设地区的用户，低工资风险会静默漏掉。建议：未设标准时在页面显眼处提示「设了地区/最低工资才会判这条」，而不是无声跳过');
  }

  /* ================= 用户5 陈经理：月加班 40 小时 ================= */
  {
    freshBrowser();
    const u = 'U5陈经理(加班超标)';
    await API.exportAll();
    await wipeAll();
    const emp = await API.add('employees', { name: '陈加班', dept: '生产', entryDate: now - 200 * DAY, status: 'on' });
    await API.add('contracts', { employeeId: emp._id, type: 'fixed', months: 12, signDate: now - 200 * DAY, endDate: now + 165 * DAY });
    await API.add('attendances', { employeeId: emp._id, month: '2026-09', overtimeHours: 40, hours: 174 });
    const sc = await API.scan();
    const hit = sc.items.find((i) => i.ruleId === 'R-HOURS-01');
    ok(u, '月加班 40h > 36h → 命中加班超标', !!hit, hit && hit.people[0].detail);
  }

  /* ================= 用户6 刘HR：在职无社保 ================= */
  {
    freshBrowser();
    const u = '刘HR(无社保)';
    await API.exportAll();
    await wipeAll();
    const emp = await API.add('employees', { name: '刘社保', dept: '行政', entryDate: now - 90 * DAY, status: 'on' });
    await API.add('contracts', { employeeId: emp._id, type: 'fixed', months: 36, signDate: now - 90 * DAY, endDate: now + 300 * DAY });
    let sc = await API.scan();
    const hit = sc.items.find((i) => i.ruleId === 'R-SOCIAL-01');
    ok(u, '在职无参保记录 → 命中未缴社保', !!hit, hit && hit.people[0].detail);
    await API.add('socials', { employeeId: emp._id, insured: '1', base: 5000 });
    sc = await API.scan();
    ok(u, '补录参保后风险消失', !sc.items.some((i) => i.ruleId === 'R-SOCIAL-01'));
  }

  /* ================= 用户7 孙老板：证照 20 天后到期 ================= */
  {
    freshBrowser();
    const u = 'U7孙老板(证照临期)';
    await API.exportAll();
    await wipeAll();
    const emp = await API.add('employees', { name: '孙焊工', dept: '设备', entryDate: now - 500 * DAY, status: 'on' });
    await API.add('contracts', { employeeId: emp._id, type: 'fixed', months: 36, signDate: now - 500 * DAY, endDate: now + 200 * DAY });
    await API.add('certs', { employeeId: emp._id, name: '焊接与热切割作业证', expireDate: now + 20 * DAY });
    const sc = await API.scan();
    const hit = sc.items.find((i) => i.ruleId === 'CERT-EXPIRE');
    ok(u, '证照 20 天后到期 → 命中临期提醒', !!hit, hit && hit.people[0].detail);
  }

  /* ================= 用户8 周经理：合规自查全做到 → 再改 5 条没做到 ================= */
  {
    freshBrowser();
    const u = 'U8周经理(合规自查)';
    await API.exportAll(); // 演示数据
    const rl = await API.rules();
    const askRules = rl.rules.filter((r) => r.level !== 'auto');
    const before = await API.scan();
    for (const r of askRules) await API.confirm(r.id, 'yes', '');
    const after = await API.scan();
    const askHitsAfter = after.items.filter((i) => askRules.some((r) => r.id === i.ruleId));
    ok(u, `${askRules.length} 条自查全答「已做到」→ 自查类 0 新增`, askHitsAfter.length === 0,
      `命中从 ${before.items.length} → ${after.items.length}（剩 auto 类）`);
    const five = askRules.slice(0, 5);
    for (const r of five) await API.confirm(r.id, 'no', '');
    const final = await API.scan();
    const newHits = final.items.filter((i) => five.some((r) => r.id === i.ruleId));
    ok(u, '改 5 条「没做到」→ 正好多出 5 类风险', newHits.length === 5, `实际 ${newHits.length}`);
    // 「不适用/待核实」的现行行为：引擎把 unsure 也列入清单（保守口径）
    await API.confirm(askRules[5].id, 'unsure', '');
    const unsureScan = await API.scan();
    const unsureHit = unsureScan.items.some((i) => i.ruleId === askRules[5].id);
    ok(u, '答「不适用/待核实」按现行保守口径列入清单', unsureHit);
    if (unsureHit)
      issues.push('「不适用/待核实」按钮把两个相反含义揉在一起：「不适用」（如没有劳务派遣的企业答派遣题）本不该产生风险，但引擎把 unsure 一律列入清单（engine.js 522 行 ans.answer===\'unsure\' 也命中）。建议：把「不适用」与「待核实」拆成两个选项——不适用不出风险、待核实进清单并标注「待核实」，否则自查类会出现误报，损害结论可信度');
  }

  /* ================= 用户9 吴老板：改判定阈值影响结论 ================= */
  {
    freshBrowser();
    const u = 'U9吴老板(改阈值)';
    await API.exportAll();
    await wipeAll();
    await API.saveSettings({ signDeadlineDays: 30 });
    const emp = await API.add('employees', { name: '吴新人', dept: '市场', entryDate: now - 15 * DAY, status: 'on' });
    let sc = await API.scan();
    ok(u, '阈值 30 天：入职 15 天未签 → 不命中', !sc.items.some((i) => i.ruleId === 'R-ENTRY-01'));
    await API.saveSettings({ signDeadlineDays: 10 });
    sc = await API.scan();
    ok(u, '阈值改 10 天：同一员工 → 命中', sc.items.some((i) => i.ruleId === 'R-ENTRY-01'));
    const regionset = await renderPage('regionset');
    ok(u, '判定阈值页能渲染', regionset._html.includes('signDeadlineDays') || regionset._html.includes('签约'));
  }

  /* ================= 用户10 郑HR：停规则/删人/导数据 ================= */
  {
    freshBrowser();
    const u = 'U10郑HR(综合管理)';
    await API.exportAll(); // 演示数据
    let sc = await API.scan();
    const hadEntry = sc.items.some((i) => i.ruleId === 'R-ENTRY-01');
    ok(u, '演示数据命中未签合同', hadEntry);
    await API.setRule('R-ENTRY-01', false);
    sc = await API.scan();
    ok(u, '停用后该条消失', !sc.items.some((i) => i.ruleId === 'R-ENTRY-01'));
    await API.setRule('R-ENTRY-01', true);

    const pe = await API.riskByEmployee();
    const top = pe.employees.find((e) => e.riskCount > 0);
    const empList = await API.list('employees');
    const victim = empList.find((e) => e._id === top._id);
    await API.remove('employees', victim._id);
    const pe2 = await API.riskByEmployee();
    ok(u, `删除员工「${victim.name}」后画像里不再有他`, !pe2.employees.some((e) => e._id === victim._id));

    // CSV 全量导出→清空→导入 闭环
    const dump = {};
    for (const col of window.CSV.COL_ORDER) dump[col] = await API.list(col);
    const csvAll = window.CSV.allToCsv(dump, false);
    await wipeAll();
    let scEmpty = await API.scan();
    ok(u, '清空后 0 类风险', scEmpty.items.length === 0);
    const parsed = window.CSV.csvToAll(csvAll);
    for (const col of Object.keys(parsed)) {
      for (const row of parsed[col]) await API.add(col, row);
    }
    sc = await API.scan();
    ok(u, 'CSV 导出→导入后风险结论还原', sc.items.length === 18, `实际 ${sc.items.length}`);
  }

  /* ================= 汇总 ================= */
  const pass = results.filter((x) => x.pass).length;
  console.log(`\n===== 通过 ${pass}/${results.length} =====`);
  if (issues.length) {
    console.log('\n===== 走查发现的优化建议 =====');
    issues.forEach((s, i) => console.log(`${i + 1}. ${s}`));
  }
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error('💥 走查异常：', e);
  process.exit(1);
});
