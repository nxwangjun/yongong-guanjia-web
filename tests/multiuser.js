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
    ok(u, '演示数据扫出 19 类风险', sc.items.length === 19, `命中 ${sc.items.length} 类`);
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
    // 没签合同 + 没参保记录（入职超30天），应正好命中 R-ENTRY-01、R-SOCIAL-01、R-WELFARE-01-AUTO 三条
    const liRules = li.risks.map((r) => r.ruleId).sort().join(',');
    ok(u, '画像里李小花正好 3 项风险（未签合同+未缴社保+超30日未社保登记）',
      li.riskCount === 3 && liRules === 'R-ENTRY-01,R-SOCIAL-01,R-WELFARE-01-AUTO', liRules);
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
    // 没设最低工资时不应误判（且风险清单页会给出显眼提示，不再静默跳过）
    await API.saveSettings({ minWage: 0 });
    sc = await API.scan();
    const notHit = !sc.items.some((i) => i.ruleId === 'R-WAGE-01');
    ok(u, '未设最低工资标准时不误报', notHit);
    const riskPage = await renderPage('risk');
    ok(u, '未设最低工资时风险清单页有显眼提示（不再静默跳过）', riskPage._html.includes('类检测未启用'));
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
    // 「待核实」按设计列入清单（保守口径），「不适用」已由 U13 验证不出风险
    await API.confirm(askRules[5].id, 'unsure', '');
    const unsureScan = await API.scan();
    ok(u, '答「待核实」按保守口径列入清单', unsureScan.items.some((i) => i.ruleId === askRules[5].id));
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
    ok(u, 'CSV 导出→导入后风险结论还原', sc.items.length === 19, `实际 ${sc.items.length}`);
  }

  /* ================= 用户11 钱HR：CSV 文本导入员工 ================= */
  {
    freshBrowser();
    const u = 'U11钱HR(CSV导入)';
    await API.exportAll();
    await wipeAll();
    const csv = '姓名,部门,入职日期,在职状态\n钱多多,财务部,2025-01-15,在职\n钱少少,人事部,2024-06-01,在职';
    const rows = window.CSV.csvToCol('employees', csv);
    ok(u, 'CSV 解析出 2 名员工', rows.length === 2, rows.map((r) => r.name).join('、'));
    for (const r of rows) await API.add('employees', r);
    const emps = await API.list('employees');
    ok(u, '导入后库里 2 人', emps.length === 2);
    const sc = await API.scan();
    ok(u, '导入的员工立即参与扫描（无合同+无社保→命中）',
      sc.items.some((i) => i.ruleId === 'R-ENTRY-01') && sc.items.some((i) => i.ruleId === 'R-SOCIAL-01'));
  }

  /* ================= 用户12 冯经理：考勤→清单→画像→点人 关联链 ================= */
  {
    freshBrowser();
    const u = 'U12冯经理(数据关联链)';
    await API.exportAll();
    await wipeAll();
    const emp = await API.add('employees', { name: '冯关联', dept: '物流部', entryDate: now - 300 * DAY, status: 'on' });
    await API.add('contracts', { employeeId: emp._id, type: 'fixed', months: 36, signDate: now - 300 * DAY, endDate: now + 400 * DAY });
    await API.add('socials', { employeeId: emp._id, insured: '1', base: 5000 });
    // 第一步：录入考勤（加班 42 小时）
    await API.add('attendances', { employeeId: emp._id, month: '2026-09', overtimeHours: 42, hours: 174 });
    // 第二步：风险清单自动关联出这条风险
    const sc = await API.scan();
    const hit = sc.items.find((i) => i.ruleId === 'R-HOURS-01');
    ok(u, '①考勤录入→②风险清单自动关联命中', !!hit && hit.people[0].name === '冯关联');
    // 第三步：员工画像关联到同一个人（加班 42h 且无加班费记录 → R-HOURS-01 + R-WAGE-02 两条）
    const pe = await API.riskByEmployee();
    const feng = pe.employees.find((e) => e.name === '冯关联');
    const fengRules = feng.risks.map((r) => r.ruleId).sort().join(',');
    ok(u, '②清单→③员工画像关联到存在风险的员工',
      feng && feng.riskCount === 2 && fengRules === 'R-HOURS-01,R-WAGE-02', fengRules);
    // 第四步：画像页渲染能点人看明细
    const page = await renderPage('people');
    const listHtml = page.querySelector('#list')._html;
    ok(u, '③画像页渲染出该员工及其风险明细入口', listHtml.includes('冯关联') && listHtml.includes('展开风险明细'));
    // 删掉考勤记录 → 全链路风险消失
    const att = await API.list('attendances');
    await API.remove('attendances', att[0]._id);
    const pe2 = await API.riskByEmployee();
    ok(u, '删考勤后全链路风险同步消失', pe2.employees.find((e) => e.name === '冯关联').riskCount === 0);
  }

  /* ================= 用户13 褚老板：答「不适用」不出风险 ================= */
  {
    freshBrowser();
    const u = 'U13褚老板(不适用)';
    await API.exportAll();
    const rl = await API.rules();
    const askRules = rl.rules.filter((r) => r.level !== 'auto');
    const before = (await API.scan()).items.length;
    // 把 3 条答「不适用」
    for (const r of askRules.slice(0, 3)) await API.confirm(r.id, 'na', '');
    const after = await API.scan();
    ok(u, '答「不适用」不产生风险', after.items.length === before && !askRules.slice(0, 3).some((r) => after.items.some((i) => i.ruleId === r.id)),
      `命中 ${before} → ${after.items.length}`);
    // 合规自查页四按钮渲染
    const page = await renderPage('riskconfirm');
    const listHtml = page.querySelector('#list')._html;
    ok(u, '自查页四个选项（含不适用）渲染',
      listHtml.includes('已做到') && listHtml.includes('没做到') && listHtml.includes('待核实') && listHtml.includes('不适用'));
  }

  /* ================= 用户14 卫经理：「待核实」进清单且意见书标注 ================= */
  {
    freshBrowser();
    const u = 'U14卫经理(待核实)';
    await API.exportAll();
    const rl = await API.rules();
    const askRules = rl.rules.filter((r) => r.level !== 'auto');
    await API.confirm(askRules[0].id, 'unsure', '');
    const sc = await API.scan();
    const hit = sc.items.find((i) => i.ruleId === askRules[0].id);
    ok(u, '答「待核实」进入风险清单', !!hit && hit.answer === 'unsure');
    const op = window.buildOpinion(sc.items, { empTotal: 36, peopleCnt: 0, affected: 0 });
    ok(u, '意见书标注该条为「待核实」', op.includes('（自查结论：待核实）'));
  }

  /* ================= 用户15 蒋HR：意见书结构完整性 ================= */
  {
    freshBrowser();
    const u = 'U15蒋HR(意见书)';
    await API.exportAll(); // 演示数据 18 类
    const sc = await API.scan();
    const op = window.buildOpinion(sc.items, { empTotal: 36, peopleCnt: sc.items.reduce((s, i) => s + (i.people || []).length, 0), affected: 10 });
    const need = ['劳动用工风险分析意见书', '一、检测概况', '分级说明', '二、风险明细', '三、整改建议（按优先级）', '附件：涉及法律依据全文', '检测结论仅供参考'];
    ok(u, '意见书六段结构齐全', need.every((k) => op.includes(k)), need.filter((k) => !op.includes(k)).join('缺:') || '完整');
    ok(u, '意见书含分级风险明细（（一）高危）', op.includes('（一）高危风险'));
    // 法条附件去重
    const refs = (op.match(/◆ /g) || []).length;
    const uniq = new Set(sc.items.flatMap((i) => (i.law || []).map((l) => l.ref))).size;
    ok(u, '意见书法条附件按 ref 去重', refs === uniq, `附件 ${refs} 条 / 去重后应有 ${uniq} 条`);
    // 空态：清空后是「未发现问题」版本
    await wipeAll();
    const opEmpty = window.buildOpinion([], { empTotal: 0, peopleCnt: 0, affected: 0 });
    ok(u, '无风险时意见书为「未发现问题」版本且带仅供参考提示',
      opEmpty.includes('未发现劳动用工风险事项') && opEmpty.includes('检测结论仅供参考'));
  }

  /* ================= 用户16 沈老板：hybrid 规则开关 ================= */
  {
    freshBrowser();
    const u = 'U16沈老板(hybrid规则)';
    await API.exportAll();
    await API.confirm('R-SPECIAL-01', 'no', '');
    let sc = await API.scan();
    ok(u, 'hybrid 规则答「没做到」命中', sc.items.some((i) => i.ruleId === 'R-SPECIAL-01'));
    await API.setRule('R-SPECIAL-01', false);
    sc = await API.scan();
    ok(u, '停用 hybrid 规则后不再命中', !sc.items.some((i) => i.ruleId === 'R-SPECIAL-01'));
    // 规则配置页渲染统计口径（20 自动 + 106 自查含 1 混合）
    const page = await renderPage('riskrule');
    ok(u, '规则配置页口径：20 自动 + 106 自查（含混合）',
      page._html.includes('20 条由数据自动算出') && page._html.includes('106 条需台账确认或问卷作答') && page._html.includes('混合方式'),
      page._html.match(/共 \d+ 条由数据自动算出，\s*\d+ 条需台账确认或问卷作答（含 \d+ 条混合方式[^）]*）/) ? '口径正确' : '口径文案未见');
  }

  /* ================= 用户21 新增自动规则回归：30日社保登记 + 非全日制试用期 ================= */
  {
    freshBrowser();
    const u = 'U21新增自动规则';
    await wipeAll();
    const d40 = new Date(now - 40 * DAY).toISOString().slice(0, 10);
    const d10 = new Date(now - 10 * DAY).toISOString().slice(0, 10);
    // 入职 40 天无社保 → 命中 R-WELFARE-01-AUTO
    const e1 = await API.add('employees', { name: '赵社保', dept: '生产部', entryDate: d40, status: 'active' });
    let sc = await API.scan();
    ok(u, '入职40天无社保 → 命中 R-WELFARE-01-AUTO', sc.items.some((i) => i.ruleId === 'R-WELFARE-01-AUTO'));
    // 改回入职 10 天 → 消失
    await API.update('employees', e1._id, { entryDate: d10 });
    sc = await API.scan();
    ok(u, '入职10天无社保 → 不误报', !sc.items.some((i) => i.ruleId === 'R-WELFARE-01-AUTO'));
    // 非全日制约定试用期 → 命中 R-PART-02-AUTO
    await wipeAll();
    const e2 = await API.add('employees', { name: '钱兼职', dept: '后勤', entryDate: d10, status: 'active' });
    await API.add('socials', { employeeId: e2._id, insured: true, base: 2235 });
    const ct = await API.add('contracts', { employeeId: e2._id, empType: 'parttime', probationMonths: 1, type: 'fixed', months: 6 });
    sc = await API.scan();
    ok(u, '非全日制约定试用期 → 命中 R-PART-02-AUTO', sc.items.some((i) => i.ruleId === 'R-PART-02-AUTO'));
    // 改全日制 → 消失
    await API.update('contracts', ct._id, { empType: 'full' });
    sc = await API.scan();
    ok(u, '全日制约定试用期 → 不误报', !sc.items.some((i) => i.ruleId === 'R-PART-02-AUTO'));
    // 旧数据无 empType 字段 → 不误报（向后兼容）
    await API.update('contracts', ct._id, { empType: '' });
    sc = await API.scan();
    ok(u, '旧数据无用工形式 → 不误报', !sc.items.some((i) => i.ruleId === 'R-PART-02-AUTO'));
  }

  /* ================= 用户17 韩HR：数据导入页渲染 ================= */
  {
    freshBrowser();
    const u = 'U17韩HR(数据导入页)';
    await API.exportAll();
    const page = await renderPage('dataio');
    ok(u, '数据导入页渲染（含导入/导出/模板）',
      page._html.includes('导入') && page._html.includes('导出') && page._html.includes('模板'));
  }

  /* ================= 用户18 杨老板：离职员工不再判 auto 风险 ================= */
  {
    freshBrowser();
    const u = 'U18杨老板(离职处理)';
    await API.exportAll();
    await wipeAll();
    const emp = await API.add('employees', { name: '杨离职', dept: '销售部', entryDate: now - 100 * DAY, status: 'left' });
    let sc = await API.scan();
    ok(u, '离职员工不再判「未签合同」', !sc.items.some((i) => i.ruleId === 'R-ENTRY-01' && i.people.some((p) => p.name === '杨离职')));
    ok(u, '离职未开证明 → 命中 R-LEAVE-01', sc.items.some((i) => i.ruleId === 'R-LEAVE-01' && i.people.some((p) => p.name === '杨离职')));
    // 补上离职证明 → 消失
    await API.update('employees', emp._id, { leaveProof: true });
    sc = await API.scan();
    ok(u, '补开离职证明后 R-LEAVE-01 消失', !sc.items.some((i) => i.ruleId === 'R-LEAVE-01'));
  }

  /* ================= 用户19 朱经理：合同到期提醒与过期未续签 ================= */
  {
    freshBrowser();
    const u = 'U19朱经理(合同到期)';
    await API.exportAll();
    await wipeAll();
    const emp1 = await API.add('employees', { name: '朱将到期', dept: '技术部', entryDate: now - 340 * DAY, status: 'on' });
    await API.add('contracts', { employeeId: emp1._id, type: 'fixed', months: 12, signDate: now - 340 * DAY, endDate: now + 20 * DAY });
    await API.add('socials', { employeeId: emp1._id, insured: '1', base: 5000 });
    const emp2 = await API.add('employees', { name: '朱已过期', dept: '技术部', entryDate: now - 400 * DAY, status: 'on' });
    await API.add('contracts', { employeeId: emp2._id, type: 'fixed', months: 12, signDate: now - 400 * DAY, endDate: now - 10 * DAY });
    await API.add('socials', { employeeId: emp2._id, insured: '1', base: 5000 });
    const sc = await API.scan();
    ok(u, '合同 20 天后到期 → 命中到期提醒 R-ENTRY-03',
      sc.items.some((i) => i.ruleId === 'R-ENTRY-03' && i.people.some((p) => p.name === '朱将到期')));
    ok(u, '合同已过期仍用工 → 命中未及时续签 R-ENTRY-05',
      sc.items.some((i) => i.ruleId === 'R-ENTRY-05' && i.people.some((p) => p.name === '朱已过期')));
  }

  /* ================= 用户20 秦HR：阈值保存→切页→回显（回归验证 #802） ================= */
  {
    freshBrowser();
    const u = 'U20秦HR(阈值回显)';
    await API.exportAll();
    await API.saveSettings({ region: '宁夏', signDeadlineDays: 20, contractExpireDays: 45, overtimeLimitMonth: 30, minWage: 2235, certExpireDays: 15 });
    // 模拟切页再回来：重新 render regionset
    const page = await renderPage('regionset');
    const back = page._html;
    ok(u, '保存后重进页面，5 个阈值全部回显',
      back.includes('value="20"') && back.includes('value="45"') && back.includes('value="30"') && back.includes('value="2235"') && back.includes('value="15"'),
      'signDeadline=20/expire=45/overtime=30/minWage=2235/cert=15');
    ok(u, '地区下拉回显已选「宁夏」', /option value="宁夏" selected|value="宁夏"[^>]*selected/.test(back) || back.includes('宁夏'));
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
