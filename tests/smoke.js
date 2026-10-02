/* 临时：HTTP 端到端冒烟（跑完可删） */
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
  try {
    j = JSON.parse(t);
  } catch (e) {}
  return { status: r.status, json: j, text: t };
}

(async () => {
  const checks = [];
  const ok = (name, cond, extra) => {
    checks.push({ name, pass: !!cond, extra: extra || '' });
    console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? ' → ' + extra : ''));
  };

  let r = await hit('GET', '/api/health');
  ok('健康检查', r.status === 200 && r.json && r.json.ok, `llm=${r.json && r.json.llmEnabled}, 语料=${r.json && r.json.corpusSize}`);

  r = await hit('GET', '/');
  ok('首页静态页', r.status === 200 && r.text.includes('用工管家'));

  r = await hit('GET', '/js/app.js');
  ok('前端脚本可访问', r.status === 200);

  r = await hit('GET', '/api/stats');
  ok('统计接口', r.status === 200 && r.json, `员工=${r.json && r.json.employees}, 风险=${r.json && r.json.risks}, 待处置=${r.json && r.json.todo}`);

  r = await hit('GET', '/api/scan');
  ok('风险扫描', r.status === 200 && r.json && Array.isArray(r.json.items), `命中 ${r.json && r.json.items.length} 条`);

  r = await hit('GET', '/api/rules');
  ok('规则库', r.status === 200 && r.json && r.json.rules.length === 116, `${r.json && r.json.rules.length} 条`);

  r = await hit('GET', '/api/c/employees');
  ok('员工列表', r.status === 200 && r.json && r.json.items.length > 0, `${r.json && r.json.items.length} 人`);

  r = await hit('GET', '/api/quiz');
  ok('自检问卷', r.status === 200 && r.json && r.json.categories.length === 20, `${r.json && r.json.categories.length} 环节`);

  // 新增一条员工再删除，验证 CRUD
  r = await hit('POST', '/api/c/employees', { name: '测试员', dept: '测试部', entryDate: Date.now(), status: 'on' });
  const newId = r.json && r.json._id;
  ok('新增员工', r.status === 200 && newId, newId || '');
  if (newId) {
    r = await hit('PUT', '/api/c/employees/' + newId, { dept: '已改部门' });
    ok('修改员工', r.status === 200 && r.json && r.json.dept === '已改部门');
    r = await hit('DELETE', '/api/c/employees/' + newId);
    ok('删除员工', r.status === 200 && r.json && r.json.ok);
  }

  // 派发处置
  r = await hit('GET', '/api/scan');
  const first = r.json.items[0];
  r = await hit('POST', '/api/dispatch', { ruleId: first.ruleId, risk: first.risk, owner: first.owner || 'hr' });
  ok('派发风险处置', r.status === 200 && r.json && r.json.ok);
  r = await hit('GET', '/api/c/riskItems');
  ok('处置台账', r.status === 200 && r.json.items.length > 0, `${r.json.items.length} 条`);

  // AI 链路：配置密钥时 mode=llm；未配置时自动降级 mode=local（两种都算链路通）
  r = await hit('POST', '/api/ai/chat', { question: '试用期最长能约定多久？', history: [] });
  ok('AI 问答', r.status === 200 && r.json && ['llm', 'local'].includes(r.json.mode), `mode=${r.json && r.json.mode}`);
  if (r.json && r.json.mode === 'llm') console.log('   回答片段：' + String(r.json.answer).slice(0, 90).replace(/\n/g, ' '));
  else console.log('   ⚠ 未配置密钥，走本地规则引擎兜底');

  r = await hit('POST', '/api/ai/explain', { item: first });
  ok('AI 解读风险', r.status === 200 && r.json && ['llm', 'local'].includes(r.json.mode), `mode=${r.json && r.json.mode}`);

  // 审计日志
  r = await hit('GET', '/api/c/audit');
  ok('审计日志', r.status === 200 && r.json.items.length > 0, `${r.json.items.length} 条`);

  const pass = checks.filter((x) => x.pass).length;
  console.log(`\n===== 通过 ${pass}/${checks.length} =====`);
})();
