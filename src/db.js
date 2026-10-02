/**
 * 数据层：JSON 文件持久化（零依赖，无需安装数据库）
 * 集合即 db.json 的顶层 key，读写走内存缓存 + 落盘。
 */
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

// 集合结构（首次运行按此初始化）
const EMPTY = {
  employees: [], contracts: [], attendances: [], payrolls: [], socials: [], certs: [],
  confirms: [], surveys: [], riskItems: [],
  applies: [], approvals: [], flows: [],
  users: [], members: [], invites: [],
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

/* ---------- 种子数据 ---------- */
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
  ];

  // e01 故意没有合同（命中"超30天未签书面合同"）
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
  ];

  const attendances = [
    { _id: 'a05', employeeId: 'e05', month: '2026-09', overtimeHours: 40 },
    { _id: 'a08', employeeId: 'e08', month: '2026-09', overtimeHours: 38 },
    { _id: 'a07', employeeId: 'e07', month: '2026-09', overtimeHours: 12 },
    { _id: 'a09', employeeId: 'e09', month: '2026-09', overtimeHours: 6 },
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
  ];

  // e01 / e07 / e10 未缴社保
  const socials = [
    { _id: 's02', employeeId: 'e02', insured: true, base: 4000 },
    { _id: 's03', employeeId: 'e03', insured: true, base: 4000 },
    { _id: 's04', employeeId: 'e04', insured: true, base: 4000 },
    { _id: 's05', employeeId: 'e05', insured: true, base: 4200 },
    { _id: 's06', employeeId: 'e06', insured: true, base: 4200 },
    { _id: 's08', employeeId: 'e08', insured: true, base: 4200 },
    { _id: 's09', employeeId: 'e09', insured: true, base: 4000 },
    { _id: 's12', employeeId: 'e12', insured: true, base: 4000 },
  ];

  const certs = [
    { _id: 'k01', employeeId: 'e05', name: '特种作业操作证（高处作业）', no: 'TZ2023-0912', expireDate: ahead(15) },
    { _id: 'k02', employeeId: 'e08', name: '特种作业操作证（电工作业）', no: 'DZ2022-3310', expireDate: ahead(75) },
    { _id: 'k03', employeeId: 'e12', name: '特种设备作业人员证', no: 'TZSB2024-0071', expireDate: ahead(200) },
  ];

  const settings = {
    companyName: '演示科技有限公司',
    companySize: '50 人以下',
    industry: '建筑工程',
    region: '宁夏银川',
    // 宁夏一类区现行标准（宁政规发〔2025〕2号，2025-10-01 起执行）
    minWage: 2235,
    signDeadlineDays: 30,
    contractExpireDays: 30,
    overtimeLimitMonth: 36,
    certExpireDays: 30,
    contactPhone: '15009665511',
    contactWechat: '15009665511',
  };

  const users = [
    { _id: 'u01', name: '王军', role: 'admin', phone: '15009665511' },
    { _id: 'u02', name: '张 HR', role: 'hr', phone: '' },
    { _id: 'u03', name: '李法务', role: 'legal', phone: '' },
  ];

  return {
    ...JSON.parse(JSON.stringify(EMPTY)),
    employees, contracts, attendances, payrolls, socials, certs,
    settings, users,
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
