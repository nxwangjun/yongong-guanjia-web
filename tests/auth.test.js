/* 临时：账号体系与权限验证 */
const BASE = 'http://localhost:3000';

async function hit(method, path, body, token) {
  const opt = { method, headers: {} };
  if (token) opt.headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + path, opt);
  const t = await r.text();
  let j = null;
  try {
    j = JSON.parse(t);
  } catch (e) {}
  return { status: r.status, json: j, text: t };
}

(async () => {
  let pass = 0, total = 0;
  const ok = (name, cond, extra) => {
    total++;
    if (cond) pass++;
    console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? ' → ' + extra : ''));
  };

  // 1. 未登录访问应被拦
  let r = await hit('GET', '/api/scan');
  ok('未登录被拦截', r.status === 401, 'HTTP ' + r.status);

  // health 应放行
  r = await hit('GET', '/api/health');
  ok('健康检查仍公开', r.status === 200);

  // 2. 管理员登录
  r = await hit('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const adminToken = r.json && r.json.token;
  ok('管理员登录', r.status === 200 && adminToken, r.json ? r.json.user.name + ' / ' + r.json.user.role : r.text.slice(0, 80));

  // 3. 登录后能扫描
  r = await hit('GET', '/api/scan', undefined, adminToken);
  ok('管理员扫描', r.status === 200 && r.json && r.json.items.length > 0, r.json ? r.json.items.length + ' 条风险' : '');

  // 4. me
  r = await hit('GET', '/api/auth/me', undefined, adminToken);
  ok('获取当前身份', r.status === 200 && r.json && r.json.user, `scope=${r.json && r.json.scope}`);

  // 5. 管理员看全部员工
  r = await hit('GET', '/api/c/employees', undefined, adminToken);
  const adminEmps = r.json ? r.json.items.length : 0;
  ok('管理员看全部员工', adminEmps >= 12, adminEmps + ' 人');

  // 6. 普通员工登录（数据范围 self，绑定 e05 吴九）
  r = await hit('POST', '/api/auth/login', { username: 'staff', password: 'staff123' });
  const staffToken = r.json && r.json.token;
  ok('员工登录', r.status === 200 && staffToken, r.json ? r.json.user.name + ' / ' + r.json.user.role : '');

  r = await hit('GET', '/api/auth/me', undefined, staffToken);
  ok('员工数据范围为 self', r.json && r.json.scope === 'self', 'scope=' + (r.json && r.json.scope));

  r = await hit('GET', '/api/c/employees', undefined, staffToken);
  const staffEmps = (r.json && r.json.items) || [];
  ok('员工只看得到自己', staffEmps.length === 1 && staffEmps[0].name === '吴九',
    staffEmps.map((e) => e.name).join(',') || '空');

  r = await hit('GET', '/api/c/payrolls', undefined, staffToken);
  const staffPay = (r.json && r.json.items) || [];
  ok('员工薪资只见自己的', staffPay.length > 0 && staffPay.every((p) => p.employeeId === 'e05'),
    staffPay.length + ' 条，均为本人');

  r = await hit('GET', '/api/c/riskItems', undefined, staffToken);
  ok('员工看不到风险处置（无模块权限）', r.status === 403, 'HTTP ' + r.status);

  // 7. 注册新公司（租户隔离）
  r = await hit('POST', '/api/auth/register', {
    username: 'boss2', password: 'boss123', name: '李四', companyName: '第二家公司',
  });
  const tk2 = r.json && r.json.token;
  ok('注册建公司', r.status === 200 && tk2, r.json ? r.json.user.companyName : r.text.slice(0, 80));

  r = await hit('GET', '/api/c/employees', undefined, tk2);
  const newEmps = r.json ? r.json.items.length : -1;
  ok('新公司数据隔离（看不到别家员工）', newEmps === 0, newEmps + ' 人');

  // 8. 邀请码带角色
  r = await hit('POST', '/api/c/invites', { code: 'TEST01', role: 'legal', used: false }, adminToken);
  ok('管理员生成带角色邀请码', r.status === 200 && r.json && r.json.role === 'legal',
    r.json ? 'role=' + r.json.role : r.text.slice(0, 60));

  r = await hit('POST', '/api/auth/join', {
    username: 'newlegal', password: 'pwd123', name: '新法务', code: 'TEST01',
  });
  ok('成员用邀请码加入并继承角色', r.status === 200 && r.json && r.json.user.role === 'legal',
    r.json ? 'role=' + r.json.user.role + ' 公司=' + r.json.user.companyName : r.text.slice(0, 80));

  // 9. 登出
  r = await hit('POST', '/api/auth/logout', {}, adminToken);
  ok('登出', r.status === 200);
  r = await hit('GET', '/api/scan', undefined, adminToken);
  ok('登出后令牌失效', r.status === 401, 'HTTP ' + r.status);

  console.log(`\n===== 通过 ${pass}/${total} =====`);
})();
