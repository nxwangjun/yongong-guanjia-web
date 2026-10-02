/**
 * 账号体系与权限（多租户）
 *
 * 模型：
 *   tenant（公司）          管理员注册时自动创建
 *   account（账号）        用户名 + 密码登录；一个账号属于一家公司、有一个角色
 *   invite（邀请码）       管理员生成，带角色；成员注册时填码加入
 *   session（登录态）      随机令牌，服务端保存，7 天有效
 *
 * 权限三段（沿用原版设计）：
 *   1. 模块：角色 → 能看哪些模块（settings.roleModules）
 *   2. 操作：本版简化为「有模块权限即可增删改查」，管理员额外拥有全部
 *   3. 数据范围：角色 → all（全部）/ dept（本部门）/ self（仅本人）（settings.roleScope）
 *
 * 密码：Node 内置 crypto.scrypt，只存 salt 与 hash，绝不存明文。
 */
const crypto = require('crypto');
const db = require('./db');

const TOKEN_DAYS = 7;
const EMPTY_SCOPE_COLLECTIONS = ['employees', 'contracts', 'attendances', 'payrolls', 'socials', 'certs'];

const DEFAULT_SCOPE = { admin: 'all', hr: 'all', legal: 'all', approver: 'dept', staff: 'self' };

function hashPwd(pwd, salt) {
  return crypto.scryptSync(String(pwd), salt, 64).toString('hex');
}

function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

function makeSession(user) {
  const d = db.load();
  const token = genToken();
  d.sessions = d.sessions || {};
  d.sessions[token] = {
    userId: user._id,
    tenantId: user.tenantId,
    role: user.role,
    name: user.name,
    dept: user.dept || '',
    employeeId: user.employeeId || '',
    exp: Date.now() + TOKEN_DAYS * 86400000,
  };
  db.saveSoon();
  return token;
}

/** 公开的用户信息（不含密码） */
function publicUser(u) {
  return {
    _id: u._id, username: u.username, name: u.name, role: u.role,
    tenantId: u.tenantId, dept: u.dept || '', employeeId: u.employeeId || '',
    companyName: (tenantOf(u.tenantId) || {}).name || '',
  };
}

function tenantOf(id) {
  return db.list('tenants').filter((t) => t._id === id)[0] || null;
}

/** 管理员注册：创建公司 + 管理员账号 */
function registerAdmin({ username, password, name, companyName }) {
  const d = db.load();
  username = String(username || '').trim();
  if (!username || !password) throw new Error('账号和密码不能为空');
  if (d.accounts.some((a) => a.username === username)) throw new Error('该账号已存在');

  const tenant = db.add('tenants', { name: companyName || (name + '的公司'), createdAt: Date.now() });
  const salt = newSalt();
  const user = db.add('accounts', {
    username, name: name || username, salt,
    passHash: hashPwd(password, salt),
    role: 'admin', tenantId: tenant._id, enabled: true,
  });
  db.log('注册管理员', `${username} 创建公司「${tenant.name}」`);
  return { token: makeSession(user), user: publicUser(user) };
}

/** 成员用邀请码加入 */
function join({ username, password, name, code }) {
  const d = db.load();
  username = String(username || '').trim();
  if (!username || !password) throw new Error('账号和密码不能为空');
  if (d.accounts.some((a) => a.username === username)) throw new Error('该账号已存在');

  const inv = db.list('invites').filter((i) => i.code === String(code || '').trim())[0];
  if (!inv) throw new Error('邀请码无效');
  if (inv.used) throw new Error('邀请码已被使用');

  const salt = newSalt();
  const user = db.add('accounts', {
    username, name: name || username, salt,
    passHash: hashPwd(password, salt),
    role: inv.role || 'staff',
    tenantId: inv.tenantId,
    dept: inv.dept || '',
    enabled: true,
  });
  db.update('invites', inv._id, { used: true, usedBy: username, usedAt: Date.now() });
  db.log('成员加入', `${username} 以「${user.role}」身份加入`);
  return { token: makeSession(user), user: publicUser(user) };
}

/** 登录 */
function login({ username, password }) {
  const d = db.load();
  const u = d.accounts.filter((a) => a.username === String(username || '').trim())[0];
  if (!u) throw new Error('账号不存在');
  if (u.enabled === false) throw new Error('账号已停用');
  if (hashPwd(password, u.salt) !== u.passHash) throw new Error('密码错误');
  db.log('登录', u.username);
  return { token: makeSession(u), user: publicUser(u) };
}

function logout(token) {
  const d = db.load();
  if (d.sessions && d.sessions[token]) {
    delete d.sessions[token];
    db.saveSoon();
  }
}

/** 取登录态（过期返回 null） */
function session(token) {
  if (!token) return null;
  const d = db.load();
  const s = (d.sessions || {})[token];
  if (!s) return null;
  if (s.exp < Date.now()) {
    delete d.sessions[token];
    return null;
  }
  return s;
}

/* ---------- 权限 ---------- */
function roleModules() {
  const s = db.load().settings || {};
  return s.roleModules || {};
}

/** 该角色能否访问某模块（管理员恒为 true） */
function canModule(role, mod) {
  if (role === 'admin') return true;
  const map = roleModules();
  const list = map[role];
  // 未配置时按出厂默认：hr 看管人+风险，legal 看法务，approver 看审批，staff 看申请+首页
  if (!list) {
    const DEFAULT = {
      hr: ['home', 'staff', 'contract', 'attend', 'payroll', 'social', 'cert', 'risk', 'risktodo', 'survey'],
      legal: ['home', 'risk', 'riskrule', 'riskconfirm', 'risktodo', 'survey', 'ai'],
      approver: ['home', 'approve'],
      // 员工可自助查看「自己」的档案/合同/考勤/薪资/社保/证照，配合 scope=self 只返回本人数据
      staff: ['home', 'apply', 'staff', 'contract', 'attend', 'payroll', 'social', 'cert'],
    };
    return (DEFAULT[role] || ['home']).includes(mod);
  }
  return list.includes(mod);
}

/** 该角色的数据范围 */
function scopeOf(role) {
  const s = db.load().settings || {};
  const m = s.roleScope || DEFAULT_SCOPE;
  return m[role] || 'all';
}

/**
 * 按数据范围过滤（只对员工相关的集合生效）
 * @returns 过滤后的数组
 */
function applyScope(items, collection, sess) {
  if (!sess || !EMPTY_SCOPE_COLLECTIONS.includes(collection)) return items;
  const scope = scopeOf(sess.role);
  if (scope === 'all') return items;

  // 先按公司隔离
  let out = items.filter((i) => !i.tenantId || i.tenantId === sess.tenantId);

  if (scope === 'self') {
    const selfId = sess.employeeId;
    if (!selfId) return [];
    if (collection === 'employees') return out.filter((i) => i._id === selfId);
    return out.filter((i) => i.employeeId === selfId);
  }

  if (scope === 'dept') {
    const dept = sess.dept;
    if (!dept) return [];
    const empIds = db
      .list('employees')
      .filter((e) => e.dept === dept)
      .map((e) => e._id);
    if (collection === 'employees') return out.filter((i) => empIds.includes(i._id));
    return out.filter((i) => empIds.includes(i.employeeId));
  }
  return out;
}

/** 按公司隔离（所有业务集合都生效） */
function byTenant(items, sess) {
  if (!sess) return items;
  return items.filter((i) => !i.tenantId || i.tenantId === sess.tenantId);
}

module.exports = {
  registerAdmin, join, login, logout, session,
  canModule, scopeOf, applyScope, byTenant, roleModules,
  hashPwd, newSalt, publicUser, tenantOf, DEFAULT_SCOPE,
};
