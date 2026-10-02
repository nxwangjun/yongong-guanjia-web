/**
 * 【勿删】本文件在 A1 免登录架构下已无运行时引用（业务数据在浏览器 localStorage），
 * 但 scripts/build-browser.js 会从本文件提取 seed() 生成 public/js/seed.js（前端演示数据）。
 * 修改演示数据请改本文件 seed() 后重跑 build-browser.js。
 * 旧职能（历史保留，现不执行）：JSON 文件持久化到 data/db.json。
 */
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

// 集合结构（首次运行按此初始化）
const EMPTY = {
  employees: [], contracts: [], attendances: [], payrolls: [], socials: [], certs: [],
  confirms: [], surveys: [], riskItems: [],
  applies: [], approvals: [], flows: [],
  audit: [], settings: {}, ruleCfg: {},
};

let db = null;

function load() {
  if (db) return db;
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      db = null;
    }
  }
  if (!db) db = seed();
  // 补齐缺失集合，避免旧文件升级时报错
  Object.keys(EMPTY).forEach((k) => {
    if (db[k] === undefined) db[k] = EMPTY[k];
  });
  save();
  return db;
}

let saveTimer = null;
function save() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('[db] 写入失败：', e.message);
  }
}
/** 合并写入（高频写时减少落盘次数） */
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save();
  }, 120);
}

/* ---------- 基础 CRUD ---------- */
function col(name) {
  load();
  if (!db[name]) db[name] = [];
  return db[name];
}

function list(name, filter) {
  const arr = col(name);
  if (typeof filter === 'function') return arr.filter(filter);
  if (filter && typeof filter === 'object') {
    return arr.filter((it) =>
      Object.keys(filter).every((k) => String(it[k]) === String(filter[k]))
    );
  }
  return arr.slice();
}

function get(name, id) {
  return col(name).filter((it) => it._id === id)[0] || null;
}

function add(name, obj) {
  const arr = col(name);
  obj._id = obj._id || genId(name);
  obj.createdAt = obj.createdAt || Date.now();
  arr.push(obj);
  saveSoon();
  return obj;
}

function update(name, id, patch) {
  const it = get(name, id);
  if (!it) return null;
  Object.keys(patch).forEach((k) => (it[k] = patch[k]));
  it.updatedAt = Date.now();
  saveSoon();
  return it;
}

function remove(name, id) {
  const arr = col(name);
  const i = arr.findIndex((it) => it._id === id);
  if (i < 0) return false;
  arr.splice(i, 1);
  saveSoon();
  return true;
}

function genId(prefix) {
  return (
    String(prefix).slice(0, 2) +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 6)
  );
}

/* ---------- 审计日志 ---------- */
function log(action, detail, who) {
  const arr = col('audit');
  arr.unshift({
    _id: genId('au'),
    action,
    detail: detail || '',
    who: who || '系统',
    at: Date.now(),
  });
  if (arr.length > 500) arr.length = 500;
  saveSoon();
}

/* ---------- 种子数据（36 人，17 类风险每类至少 2 人命中） ---------- */
function seed() {
  const DAY = 86400000;
  const now = Date.now();
  const ago = (d) => now - d * DAY;
  const ahead = (d) => now + d * DAY;

  const employees = [
    { _id: 'e01', name: '王五', dept: '工程部', entryDate: ago(448), status: 'on', empNo: 'G001' },
    { _id: 'e02', name: '赵六', dept: '综合部', entryDate: ago(1100), status: 'on', empNo: 'Z001' },
    { _id: 'e03', name: '孙七', dept: '财务部', entryDate: ago(730), status: 'on', empNo: 'C001' },
    { _id: 'e04', name: '周八', dept: '工程部', entryDate: ago(60), status: 'on', empNo: 'G002' },
    { _id: 'e05', name: '吴九', dept: '工程部', entryDate: ago(400), status: 'on', empNo: 'G003' },
    { _id: 'e06', name: '郑十', dept: '综合部', entryDate: ago(900), status: 'on', empNo: 'Z002' },
    { _id: 'e07', name: '钱一', dept: '工程部', entryDate: ago(120), status: 'on', empNo: 'G004' },
    { _id: 'e08', name: '陈二', dept: '工程部', entryDate: ago(300), status: 'on', empNo: 'G005' },
    { _id: 'e09', name: '褚三', dept: '财务部', entryDate: ago(200), status: 'on', empNo: 'C002' },
    { _id: 'e10', name: '卫四', dept: '综合部', entryDate: ago(50), status: 'on', empNo: 'Z003' },
    { _id: 'e11', name: '蒋五', dept: '工程部', entryDate: ago(800), status: 'left', empNo: 'G006', leaveProof: false },
    { _id: 'e12', name: '沈六', dept: '工程部', entryDate: ago(95), status: 'on', empNo: 'G007' },
    { _id: 'e13', name: '韩七', dept: '工程部', entryDate: ago(500), status: 'on', empNo: 'G008' },
    { _id: 'e14', name: '杨八', dept: '综合部', entryDate: ago(75), status: 'on', empNo: 'Z004' },
    { _id: 'e15', name: '朱九', dept: '财务部', entryDate: ago(260), status: 'on', empNo: 'C003' },
    { _id: 'e16', name: '秦十', dept: '工程部', entryDate: ago(180), status: 'on', empNo: 'G009' },
    { _id: 'e17', name: '许一', dept: '综合部', entryDate: ago(950), status: 'on', empNo: 'Z005' },
    { _id: 'e18', name: '何二', dept: '工程部', entryDate: ago(1300), status: 'on', empNo: 'G010' },
    { _id: 'e19', name: '吕三', dept: '财务部', entryDate: ago(320), status: 'on', empNo: 'C004' },
    { _id: 'e20', name: '施四', dept: '综合部', entryDate: ago(85), status: 'on', empNo: 'Z006' },
    { _id: 'e21', name: '张五', dept: '工程部', entryDate: ago(240), status: 'on', empNo: 'G011' },
    { _id: 'e22', name: '孔六', dept: '综合部', entryDate: ago(600), status: 'on', empNo: 'Z007' },
    { _id: 'e23', name: '曹七', dept: '财务部', entryDate: ago(150), status: 'on', empNo: 'C005' },
    { _id: 'e24', name: '严八', dept: '工程部', entryDate: ago(45), status: 'on', empNo: 'G012' },
    { _id: 'e25', name: '华九', dept: '综合部', entryDate: ago(760), status: 'on', empNo: 'Z008' },
    { _id: 'e26', name: '金十', dept: '工程部', entryDate: ago(380), status: 'on', empNo: 'G013' },
    { _id: 'e27', name: '魏一', dept: '财务部', entryDate: ago(550), status: 'on', empNo: 'C006' },
    { _id: 'e28', name: '陶二', dept: '综合部', entryDate: ago(65), status: 'on', empNo: 'Z009' },
    { _id: 'e29', name: '姜三', dept: '工程部', entryDate: ago(290), status: 'on', empNo: 'G014' },
    { _id: 'e30', name: '戚四', dept: '财务部', entryDate: ago(410), status: 'on', empNo: 'C007' },
    { _id: 'e31', name: '谢五', dept: '综合部', entryDate: ago(100), status: 'on', empNo: 'Z010' },
    { _id: 'e32', name: '邹六', dept: '工程部', entryDate: ago(470), status: 'on', empNo: 'G015' },
    { _id: 'e33', name: '喻七', dept: '综合部', entryDate: ago(340), status: 'on', empNo: 'Z011' },
    { _id: 'e34', name: '柏八', dept: '财务部', entryDate: ago(210), status: 'on', empNo: 'C008' },
    { _id: 'e35', name: '水九', dept: '工程部', entryDate: ago(55), status: 'on', empNo: 'G016' },
    { _id: 'e36', name: '窦十', dept: '综合部', entryDate: ago(920), status: 'on', empNo: 'Z012' },
  ];

  // e01 / e13 / e18 故意没有合同（命中"超30天未签书面合同"）
  const contracts = [
    { _id: 'c02', employeeId: 'e02', type: 'fixed', months: 36, probationMonths: 8, endDate: ahead(500), signDate: ago(1100) },
    { _id: 'c03', employeeId: 'e03', type: 'fixed', months: 24, probationMonths: 2, endDate: ahead(20), signDate: ago(730) },
    { _id: 'c03b', employeeId: 'e03', type: 'fixed', months: 24, probationMonths: 0, endDate: ahead(20), signDate: ago(370) },
    { _id: 'c04', employeeId: 'e04', type: 'fixed', months: 24, probationMonths: 2, endDate: ahead(660), signDate: ago(60) },
    { _id: 'c05', employeeId: 'e05', type: 'fixed', months: 12, probationMonths: 1, endDate: ahead(200), signDate: ago(400) },
    { _id: 'c06', employeeId: 'e06', type: 'open', months: 0, probationMonths: 2, endDate: 0, signDate: ago(900) },
    { _id: 'c07', employeeId: 'e07', type: 'fixed', months: 12, probationMonths: 1, endDate: ahead(245), signDate: ago(120) },
    { _id: 'c08', employeeId: 'e08', type: 'fixed', months: 24, probationMonths: 2, endDate: ahead(430), signDate: ago(300) },
    { _id: 'c09', employeeId: 'e09', type: 'fixed', months: 24, probationMonths: 2, endDate: ahead(530), signDate: ago(200) },
    { _id: 'c10', employeeId: 'e10', type: 'fixed', months: 12, probationMonths: 1, endDate: ahead(310), signDate: ago(50) },
    { _id: 'c12', employeeId: 'e12', type: 'fixed', months: 36, probationMonths: 6, endDate: ahead(1000), signDate: ago(95) },
    // e14 试用期超上限（2个月合同只能1个月，实际3个月）
    { _id: 'c14', employeeId: 'e14', type: 'fixed', months: 2, probationMonths: 3, endDate: ahead(10), signDate: ago(75) },
    // e16 合同已过期仍在用工
    { _id: 'c16', employeeId: 'e16', type: 'fixed', months: 12, probationMonths: 1, endDate: ago(40), signDate: ago(400) },
    // e17 连续两次固定期限后仍是固定期限
    { _id: 'c17a', employeeId: 'e17', type: 'fixed', months: 12, probationMonths: 1, endDate: ago(950), signDate: ago(1330) },
    { _id: 'c17b', employeeId: 'e17', type: 'fixed', months: 12, probationMonths: 1, endDate: ago(570), signDate: ago(950) },
    { _id: 'c17c', employeeId: 'e17', type: 'fixed', months: 12, probationMonths: 1, endDate: ahead(190), signDate: ago(570) },
    // e19 合同即将到期（15天后）
    { _id: 'c19', employeeId: 'e19', type: 'fixed', months: 24, probationMonths: 2, endDate: ahead(15), signDate: ago(320) },
    // e20 合同即将到期（10天后）
    { _id: 'c20', employeeId: 'e20', type: 'fixed', months: 12, probationMonths: 1, endDate: ahead(10), signDate: ago(85) },
    // e21 正常合同
    { _id: 'c21', employeeId: 'e21', type: 'fixed', months: 36, probationMonths: 3, endDate: ahead(880), signDate: ago(240) },
    // e22 正常合同
    { _id: 'c22', employeeId: 'e22', type: 'fixed', months: 24, probationMonths: 2, endDate: ahead(620), signDate: ago(600) },
    // e23 试用期超上限（12个月合同只能2个月，实际4个月）
    { _id: 'c23', employeeId: 'e23', type: 'fixed', months: 12, probationMonths: 4, endDate: ahead(215), signDate: ago(150) },
    // e25 合同已过期仍在用工
    { _id: 'c25', employeeId: 'e25', type: 'fixed', months: 12, probationMonths: 1, endDate: ago(30), signDate: ago(395) },
    // e26 正常合同
    { _id: 'c26', employeeId: 'e26', type: 'fixed', months: 24, probationMonths: 2, endDate: ahead(440), signDate: ago(380) },
    // e27 正常合同
    { _id: 'c27', employeeId: 'e27', type: 'fixed', months: 24, probationMonths: 2, endDate: ahead(570), signDate: ago(550) },
    // e28 合同即将到期（5天后）
    { _id: 'c28', employeeId: 'e28', type: 'fixed', months: 12, probationMonths: 1, endDate: ahead(5), signDate: ago(65) },
    // e29 正常合同
    { _id: 'c29', employeeId: 'e29', type: 'fixed', months: 36, probationMonths: 3, endDate: ahead(810), signDate: ago(290) },
    // e30 正常合同
    { _id: 'c30', employeeId: 'e30', type: 'fixed', months: 24, probationMonths: 2, endDate: ahead(430), signDate: ago(410) },
    // e32 正常合同
    { _id: 'c32', employeeId: 'e32', type: 'fixed', months: 36, probationMonths: 3, endDate: ahead(1000), signDate: ago(470) },
    // e33 正常合同
    { _id: 'c33', employeeId: 'e33', type: 'fixed', months: 24, probationMonths: 2, endDate: ahead(640), signDate: ago(340) },
    // e34 正常合同
    { _id: 'c34', employeeId: 'e34', type: 'fixed', months: 12, probationMonths: 1, endDate: ahead(240), signDate: ago(210) },
    // e35 试用期超上限（6个月合同只能1个月，实际3个月）
    { _id: 'c35', employeeId: 'e35', type: 'fixed', months: 6, probationMonths: 3, endDate: ahead(150), signDate: ago(55) },
    // e36 正常合同
    { _id: 'c36', employeeId: 'e36', type: 'fixed', months: 24, probationMonths: 2, endDate: ahead(620), signDate: ago(920) },
    // e24 合同即将到期（25天后）
    { _id: 'c24', employeeId: 'e24', type: 'fixed', months: 12, probationMonths: 1, endDate: ahead(25), signDate: ago(45) },
    // e31 合同即将到期（20天后）
    { _id: 'c31', employeeId: 'e31', type: 'fixed', months: 12, probationMonths: 1, endDate: ahead(20), signDate: ago(100) },
  ];

  const attendances = [
    { _id: 'a05', employeeId: 'e05', month: '2026-09', overtimeHours: 40 },
    { _id: 'a08', employeeId: 'e08', month: '2026-09', overtimeHours: 38 },
    { _id: 'a07', employeeId: 'e07', month: '2026-09', overtimeHours: 12 },
    { _id: 'a09', employeeId: 'e09', month: '2026-09', overtimeHours: 6 },
    // e14 加班 45 小时超上限
    { _id: 'a14', employeeId: 'e14', month: '2026-09', overtimeHours: 45 },
    // e16 加班 42 小时超上限
    { _id: 'a16', employeeId: 'e16', month: '2026-09', overtimeHours: 42 },
    // e21 加班 20 小时（正常）
    { _id: 'a21', employeeId: 'e21', month: '2026-09', overtimeHours: 20 },
    // e24 加班 50 小时超上限
    { _id: 'a24', employeeId: 'e24', month: '2026-09', overtimeHours: 50 },
    // e26 加班 39 小时超上限
    { _id: 'a26', employeeId: 'e26', month: '2026-09', overtimeHours: 39 },
    // e29 加班 25 小时（正常）
    { _id: 'a29', employeeId: 'e29', month: '2026-09', overtimeHours: 25 },
    // e32 加班 15 小时（正常）
    { _id: 'a32', employeeId: 'e32', month: '2026-09', overtimeHours: 15 },
    // e35 加班 55 小时超上限
    { _id: 'a35', employeeId: 'e35', month: '2026-09', overtimeHours: 55 },
  ];

  const payrolls = [
    { _id: 'p02', employeeId: 'e02', month: '2026-09', amount: 6000, overtimePay: 0 },
    { _id: 'p03', employeeId: 'e03', month: '2026-09', amount: 5200, overtimePay: 0 },
    { _id: 'p04', employeeId: 'e04', month: '2026-09', amount: 4800, overtimePay: 0 },
    { _id: 'p05', employeeId: 'e05', month: '2026-09', amount: 7000, overtimePay: 1200 },
    { _id: 'p06', employeeId: 'e06', month: '2026-09', amount: 5600, overtimePay: 0 },
    { _id: 'p07', employeeId: 'e07', month: '2026-09', amount: 4300, overtimePay: 0 },
    { _id: 'p07b', employeeId: 'e07', month: '2026-09', amount: 4000, formalAmount: 5600, probation: true, overtimePay: 0 },
    { _id: 'p08', employeeId: 'e08', month: '2026-09', amount: 6200, overtimePay: 900 },
    { _id: 'p09', employeeId: 'e09', month: '2026-09', amount: 5000, overtimePay: 0 },
    { _id: 'p10', employeeId: 'e10', month: '2026-09', amount: 1750, overtimePay: 0 },
    { _id: 'p12', employeeId: 'e12', month: '2026-09', amount: 4500, overtimePay: 0 },
    // e14 试用期工资低于转正80%（试用期3200，转正5000，80%=4000）
    { _id: 'p14', employeeId: 'e14', month: '2026-09', amount: 3200, formalAmount: 5000, probation: true, overtimePay: 800 },
    // e16 加班费占工资比超30%（工资4000，加班费1500，占比37.5%）
    { _id: 'p16', employeeId: 'e16', month: '2026-09', amount: 4000, overtimePay: 1500 },
    // e19 加班费占工资比超30%（工资3500，加班费1300，占比37.1%）
    { _id: 'p19', employeeId: 'e19', month: '2026-09', amount: 3500, overtimePay: 1300 },
    // e20 试用期工资低于转正80%（试用期3500，转正5000，80%=4000）
    { _id: 'p20', employeeId: 'e20', month: '2026-09', amount: 3500, formalAmount: 5000, probation: true, overtimePay: 0 },
    // e21 正常
    { _id: 'p21', employeeId: 'e21', month: '2026-09', amount: 5500, overtimePay: 600 },
    // e23 试用期工资低于最低工资（1800 < 2235）
    { _id: 'p23', employeeId: 'e23', month: '2026-09', amount: 1800, formalAmount: 4500, probation: true, overtimePay: 0 },
    // e24 正常
    { _id: 'p24', employeeId: 'e24', month: '2026-09', amount: 4200, overtimePay: 1000 },
    // e26 加班费占工资比超30%（工资3000，加班费1200，占比40%）
    { _id: 'p26', employeeId: 'e26', month: '2026-09', amount: 3000, overtimePay: 1200 },
    // e28 试用期工资低于转正80%（试用期2800，转正4000，80%=3200）
    { _id: 'p28', employeeId: 'e28', month: '2026-09', amount: 2800, formalAmount: 4000, probation: true, overtimePay: 0 },
    // e29 正常
    { _id: 'p29', employeeId: 'e29', month: '2026-09', amount: 5000, overtimePay: 800 },
    // e32 正常
    { _id: 'p32', employeeId: 'e32', month: '2026-09', amount: 4800, overtimePay: 500 },
    // e35 试用期工资低于转正80%（试用期3600，转正6000，80%=4800）
    { _id: 'p35', employeeId: 'e35', month: '2026-09', amount: 3600, formalAmount: 6000, probation: true, overtimePay: 1200 },
  ];

  // e01 / e07 / e10 / e13 / e17 / e25 / e31 未缴社保
  const socials = [
    { _id: 's02', employeeId: 'e02', insured: true, base: 4000 },
    { _id: 's03', employeeId: 'e03', insured: true, base: 4000 },
    { _id: 's04', employeeId: 'e04', insured: true, base: 4000 },
    { _id: 's05', employeeId: 'e05', insured: true, base: 4200 },
    { _id: 's06', employeeId: 'e06', insured: true, base: 4200 },
    { _id: 's08', employeeId: 'e08', insured: true, base: 4200 },
    { _id: 's09', employeeId: 'e09', insured: true, base: 4000 },
    { _id: 's12', employeeId: 'e12', insured: true, base: 4000 },
    // e14 缴费基数低于工资（工资3200，基数2000）
    { _id: 's14', employeeId: 'e14', insured: true, base: 2000 },
    // e16 缴费基数低于工资（工资4000，基数2500）
    { _id: 's16', employeeId: 'e16', insured: true, base: 2500 },
    // e19 缴费基数低于工资（工资3500，基数2200）
    { _id: 's19', employeeId: 'e19', insured: true, base: 2200 },
    { _id: 's21', employeeId: 'e21', insured: true, base: 4200 },
    { _id: 's23', employeeId: 'e23', insured: true, base: 3800 },
    { _id: 's24', employeeId: 'e24', insured: true, base: 4000 },
    { _id: 's26', employeeId: 'e26', insured: true, base: 3600 },
    { _id: 's28', employeeId: 'e28', insured: true, base: 3200 },
    { _id: 's29', employeeId: 'e29', insured: true, base: 4000 },
    { _id: 's32', employeeId: 'e32', insured: true, base: 4200 },
    { _id: 's35', employeeId: 'e35', insured: true, base: 3800 },
  ];

  const certs = [
    { _id: 'k01', employeeId: 'e05', name: '特种作业操作证（高处作业）', no: 'TZ2023-0912', expireDate: ahead(15) },
    { _id: 'k02', employeeId: 'e08', name: '特种作业操作证（电工作业）', no: 'DZ2022-3310', expireDate: ahead(75) },
    { _id: 'k03', employeeId: 'e12', name: '特种设备作业人员证', no: 'TZSB2024-0071', expireDate: ahead(200) },
    // e21 证照即将到期（20天后）
    { _id: 'k04', employeeId: 'e21', name: '特种作业操作证（焊接与热切割作业）', no: 'TZ2023-0555', expireDate: ahead(20) },
    // e29 证照即将到期（10天后）
    { _id: 'k05', employeeId: 'e29', name: '特种作业操作证（制冷与空调作业）', no: 'TZ2022-1188', expireDate: ahead(10) },
  ];

  const settings = {
    companyName: '演示科技有限公司',
    region: '宁夏银川',
    // 宁夏一类区现行标准（宁政规发〔2025〕2号，2025-10-01 起执行）
    minWage: 2235,
    signDeadlineDays: 30,
    contractExpireDays: 30,
    overtimeLimitMonth: 36,
    certExpireDays: 30,
  };

  return {
    ...JSON.parse(JSON.stringify(EMPTY)),
    employees, contracts, attendances, payrolls, socials, certs,
    settings,
    audit: [{ _id: 'au0', action: '初始化', detail: '生成演示数据', who: '系统', at: Date.now() }],
  };
}

/** 重置为演示数据 */
function reset() {
  db = seed();
  save();
  return db;
}

module.exports = {
  load, save, saveSoon, reset,
  col, list, get, add, update, remove, genId, log,
};
