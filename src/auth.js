/**
 * 账号体系与权限（多租户）
 *
 * 模型：
 *   tenant（公司）          管理员注册时自动创建
 *   account（账号）        用户名 + 密码登录；一个账号属于一家公司、有一个角色
 *   invite（邀请码）       管理员生成，带角色；成员注册时填码加入
 *   session（登录态）      随机令牌，服务端保存，7 天有效
 *
 * 权限模型（两角色）：
 *   admin 管理员 —— 全部模块
 *   user  普通用户 —— 除「成员账户 / 系统设置」外的全部模块
 *   旧库里的 hr/legal/approver/staff 账号统一按普通用户对待（见 DEFAULT_MODULES 兜底）
 *
 * 密码：Node 内置 crypto.scrypt，只存 salt 与 hash，绝不存明文。
 */
const crypto = require('crypto');
const db = require('./db');

const TOKEN_DAYS = 7;

// 普通用户可见模块（与前端 app.js 的 USER_MODULES 保持一致）
const USER_MODULES = ['home', 'people', 'risk', 'riskconfirm', 'risktodo', 'riskrule', 'ai',
  'staff', 'contract', 'attend', 'payroll', 'social', 'cert', 'dataio'];

// 出厂模块权限：admin 全通；user 及旧角色（hr/legal/approver/staff）均按普通用户
const DEFAULT_MODULES = {
  admin: USER_MODULES.concat(['member', 'setting']),
  user: USER_MODULES,
  hr: USER_MODULES, legal: USER_MODULES, approver: USER_MODULES, staff: USER_MODULES,
};

// 角色默认名称（两角色；旧角色名也兜底，避免老账号显示成英文）
const DEFAULT_ROLE_NAMES = {
  admin: '管理员', user: '普通用户',
  hr: '普通用户', legal: '普通用户', approver: '普通用户', staff: '普通用户',
};

/** 角色显示名：优先用管理员改过的，其次出厂默认 */
function roleName(role) {
  const s = db.load().settings || {};
  const names = s.roleNames || {};
  return names[role] || DEFAULT_ROLE_NAMES[role] || role || '';
}
function roleNames() {
  return Object.assign({}, DEFAULT_ROLE_NAMES);
}

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
    role: inv.role === 'admin' ? 'admin' : 'user',
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
  return DEFAULT_MODULES;
}

/** 该角色能否访问某模块（管理员恒为 true；其余一律按普通用户） */
function canModule(role, mod) {
  if (role === 'admin') return true;
  return USER_MODULES.includes(mod);
}

/** 数据范围：两角色均为全部（本公司内） */
function scopeOf() {
  return 'all';
}

/** 按公司隔离（所有业务集合都生效） */
function byTenant(items, sess) {
  if (!sess) return items;
  return items.filter((i) => !i.tenantId || i.tenantId === sess.tenantId);
}

/** 数据范围过滤：两角色模型下不做二次裁剪，仅按公司隔离 */
function applyScope(items, collection, sess) {
  return byTenant(items, sess);
}

module.exports = {
  registerAdmin, join, login, logout, session,
  canModule, scopeOf, applyScope, byTenant, roleModules, roleName, roleNames,
  hashPwd, newSalt, publicUser, tenantOf,
  DEFAULT_MODULES, DEFAULT_ROLE_NAMES, USER_MODULES,
};
