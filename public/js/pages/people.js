/* 员工风险画像 —— 检测系统的核心视图：逐人看风险 */
window.PAGES = window.PAGES || {};

const DISCLAIMER2 =
  '⚠️ 检测结论由系统依据录入数据与确认台账自动生成，仅供初步自查参考，不构成正式法律意见，也不替代律师当面咨询与阅卷。';

PAGES.people = {
  title: '员工风险画像',
  async render(c) {
    c.innerHTML = `<div class="notice">${DISCLAIMER2}</div><div class="card">正在测算…</div>`;
    let data;
    try {
      data = await API.get('/api/risk/by-employee');
    } catch (e) {
      c.innerHTML = `<div class="card">测算失败：${UI.esc(e.message)}</div>`;
      return;
    }

    const emps = data.employees || [];
    const totalRisk = emps.reduce((s, e) => s + e.riskCount, 0);
    const highRisk = emps.reduce((s, e) => s + e.highCount, 0);
    const affected = emps.filter((e) => e.riskCount > 0).length;

    c.innerHTML = `
      <div class="notice">${DISCLAIMER2}</div>
      <div class="stat-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:14px">
        <div class="stat"><b>${emps.length}</b><span>员工总数</span></div>
        <div class="stat alert"><b>${affected}</b><span>存在风险的员工</span></div>
        <div class="stat alert"><b>${highRisk}</b><span>高危问题数</span></div>
        <div class="stat"><b>${totalRisk}</b><span>风险项合计</span></div>
      </div>
      <div class="card">
        <div class="toolbar">
          <h2 style="margin:0">员工风险画像（按风险从高到低）</h2>
          <div class="spacer"></div>
          <input class="search" id="kw" placeholder="搜索姓名 / 部门…" />
          <button class="btn" id="rescan">重新测算</button>
        </div>
        <div id="list"></div>
        ${emps.length ? '' : '<p style="color:var(--muted)">还没有员工数据。先到「数据导入」导入员工档案，或在「员工档案」里录入。</p>'}
      </div>`;

    const listEl = c.querySelector('#list');

    function draw(kw) {
      const arr = kw
        ? emps.filter((e) => (e.name || '').includes(kw) || (e.dept || '').includes(kw))
        : emps;
      listEl.innerHTML = arr.length
        ? arr.map((e, i) => card(e, i)).join('')
        : '<p style="color:var(--muted)">没有匹配的员工</p>';

      listEl.querySelectorAll('[data-toggle]').forEach((b) => {
        b.onclick = () => {
          const body = listEl.querySelector('#body-' + b.dataset.toggle);
          body.classList.toggle('show');
          b.textContent = body.classList.contains('show') ? '收起' : '展开风险明细';
        };
      });
      listEl.querySelectorAll('[data-ai]').forEach((b) => {
        b.onclick = async () => {
          const e = arr[b.dataset.ai];
          const box = listEl.querySelector('#ai-' + b.dataset.ai);
          box.classList.add('show');
          box.textContent = 'AI 正在结合法条生成整改方案…';
          b.disabled = true;
          try {
            const r = await API.explain({
              risk: `${e.name}（${e.dept || '未填部门'}）存在 ${e.riskCount} 项用工风险：\n` +
                e.risks.map((x) => '· ' + x.risk + '（' + x.detail + '）').join('\n'),
              law: e.risks[0] ? e.risks[0].law : [],
              people: e.risks.map((x) => ({ name: e.name, dept: e.dept, detail: x.detail })),
              consequence: e.risks.map((x) => x.consequence).filter(Boolean).join('\n'),
              remedy: [...new Set(e.risks.flatMap((x) => x.remedy || []))],
            });
            box.textContent = r.text + '\n\n（' + r.model + '）';
          } catch (err) {
            box.textContent = '生成失败：' + err.message;
          }
          b.disabled = false;
        };
      });
    }

    draw('');
    c.querySelector('#kw').oninput = (e) => draw(e.target.value.trim());
    c.querySelector('#rescan').onclick = () => PAGES.people.render(c);
  },
};

function card(e, i) {
  const risks = e.risks || [];
  const badge = e.riskCount
    ? e.highCount
      ? `<span class="tag red">${e.highCount} 项高危</span><span class="tag orange">共 ${e.riskCount} 项</span>`
      : `<span class="tag orange">${e.riskCount} 项待关注</span>`
    : '<span class="tag green">未发现风险</span>';

  const entry = e.entryDate
    ? `入职 ${Math.floor((Date.now() - e.entryDate) / 86400000)} 天`
    : '';

  const detail = risks
    .map(
      (r) => `<div class="risk-item ${r.sev === '高' ? 'first' : ''}" style="margin:8px 0">
      <div class="ri-head">
        <span class="tag ${r.sev === '高' ? 'red' : 'orange'}">${UI.esc(r.sev)}</span>
        <span class="ri-title">${UI.esc(r.risk)}</span>
      </div>
      <div class="row" style="font-size:13px;color:#374151">${UI.esc(r.detail)}</div>
      ${r.consequence ? `<div class="row" style="font-size:12.5px;color:var(--muted)"><b>后果：</b>${UI.esc(r.consequence)}</div>` : ''}
      ${(r.remedy || []).length
        ? `<div class="row" style="font-size:12.5px"><b>建议：</b>${r.remedy.map((x) => UI.esc(x)).join('；')}</div>`
        : ''}
      ${(r.law || []).length
        ? `<div class="law-text">${r.law.map((l) => '<b>' + UI.esc(l.ref) + '</b>　' + UI.esc(l.text)).join('<br/>')}</div>`
        : ''}
    </div>`
    )
    .join('');

  return `
  <div class="risk-item" style="border-left-color:${e.highCount ? '#dc2626' : e.riskCount ? '#f59e0b' : '#10b981'}">
    <div class="ri-head">
      <span class="ri-title">${UI.esc(e.name)}</span>
      <span class="ri-meta">${UI.esc(e.dept || '未填部门')}${entry ? ' · ' + entry : ''}${e.status === 'left' ? ' · 已离职' : ''}</span>
      ${badge}
    </div>
    ${risks.length
      ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn small" data-toggle="${i}">展开风险明细</button>
          <button class="btn small" data-ai="${i}">AI 生成整改方案</button>
        </div>
        <div class="ri-body" id="body-${i}">${detail}</div>
        <div class="ai-box" id="ai-${i}"></div>`
      : '<div style="font-size:13px;color:var(--muted)">各项检测均未发现异常</div>'}
  </div>`;
}
