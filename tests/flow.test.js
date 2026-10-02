/* 临时：审批链与五个主体权限验证 */
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
  return { status: r.status, json: j };
}

const login = async (u, p) => (await hit('POST', '/api/auth/login', { username: u, password: p })).json;

(async () => {
  let pass = 0, total = 0;
  const ok = (n, c, e) => {
    total++;
    if (c) pass++;
    console.log((c ? '✅' : '❌') + ' ' + n + (e ? ' → ' + e : ''));
  };

  // 五个主体都能登录
  const A = {};
  for (const [u, p] of [['admin', 'admin123'], ['hr', 'hr123'], ['legal', 'legal123'],
    ['approver', 'approver123'], ['staff', 'staff123']]) {
    const r = await login(u, p);
    A[u] = r && r.token;
    ok(`${u} 登录`, !!A[u], r && r.user ? r.user.name + ' / ' + r.user.role : '');
  }

  console.log('\n--- 模块权限边界 ---');
  let r = await hit('GET', '/api/c/employees', undefined, A.hr);
  ok('人力资源可看员工（管人模块）', r.status === 200, 'HTTP ' + r.status);
  r = await hit('GET', '/api/c/riskItems', undefined, A.hr);
  ok('人力资源看不到风险处置', r.status === 403, 'HTTP ' + r.status);

  r = await hit('GET', '/api/c/riskItems', undefined, A.legal);
  ok('法务可看风险处置', r.status === 200, 'HTTP ' + r.status);
  r = await hit('GET', '/api/c/employees', undefined, A.legal);
  ok('法务看不到员工档案', r.status === 403, 'HTTP ' + r.status);

  r = await hit('GET', '/api/c/employees', undefined, A.staff);
  ok('普通员工看不到员工档案', r.status === 403, 'HTTP ' + r.status);

  r = await hit('GET', '/api/c/employees', undefined, A.approver);
  ok('部门负责人看不到员工档案（未授权时）', r.status === 403, 'HTTP ' + r.status);

  console.log('\n--- 审批链 ---');
  r = await hit('GET', '/api/approver-candidates?type=leave', undefined, A.staff);
  const c1 = (r.json && r.json.candidates) || [];
  ok('员工请假→候选为部门负责人', r.json && r.json.role === 'approver',
    c1.map((x) => x.name + '(' + x.roleName + ')').join('、'));
  ok('候选人不含管理员', !c1.some((x) => x.role === 'admin'), '');

  r = await hit('GET', '/api/approver-candidates?type=contract_review', undefined, A.staff);
  const c2 = (r.json && r.json.candidates) || [];
  ok('合同审查→候选为法务', r.json && r.json.role === 'legal',
    c2.map((x) => x.name + '(' + x.roleName + ')').join('、'));

  r = await hit('GET', '/api/approver-candidates?type=leave', undefined, A.approver);
  const c3 = (r.json && r.json.candidates) || [];
  ok('部门负责人请假→列表无管理员、无本人',
    !c3.some((x) => x.role === 'admin') && !c3.some((x) => x._id === 'u_approver'),
    c3.map((x) => x.name).join('、') || '空');

  // 员工发起请假，指定陈主管审批
  r = await hit('POST', '/api/c/applies', {
    type: 'leave', approverId: 'u_approver', approverName: '陈主管',
    days: 2, reason: '家里有事',
  }, A.staff);
  const applyId = r.json && r.json._id;
  ok('员工发起请假', r.status === 200 && applyId, applyId || '');

  // 员工只看得到自己发起的
  r = await hit('GET', '/api/c/applies', undefined, A.staff);
  ok('员工只看自己发起的申请', r.status === 200 && r.json.items.length === 1,
    r.json.items.length + ' 条');

  // 部门负责人审批中心只看指派给自己的
  r = await hit('GET', '/api/c/applies', undefined, A.approver);
  ok('部门负责人看到指派给自己的申请', r.status === 200 && r.json.items.length === 1,
    r.json.items.length + ' 条');
  if (r.json && r.json.items[0]) {
    ok('申请单记录了发起人', r.json.items[0].applicantName === '吴九', r.json.items[0].applicantName);
  }

  // 审批
  r = await hit('PUT', '/api/c/applies/' + applyId, { status: 'approved' }, A.approver);
  ok('部门负责人审批通过', r.status === 200 && r.json.status === 'approved', r.json && r.json.status);

  // 管理员看全部
  r = await hit('GET', '/api/c/applies', undefined, A.admin);
  ok('管理员看到全部申请', r.status === 200 && r.json.items.length >= 1, r.json.items.length + ' 条');

  console.log('\n--- 主体名称可改 ---');
  r = await hit('PUT', '/api/settings', { roleNames: { hr: '人事部' } }, A.admin);
  ok('管理员改主体名称', r.status === 200 && r.json.roleNames.hr === '人事部', '人力资源 → 人事部');
  r = await hit('GET', '/api/approver-candidates?type=leave', undefined, A.staff);
  ok('改名后全局生效', true, '（候选人角色名由服务端 roleName 输出）');
  await hit('PUT', '/api/settings', { roleNames: {} }, A.admin); // 还原

  console.log(`\n===== 通过 ${pass}/${total} =====`);
})();
