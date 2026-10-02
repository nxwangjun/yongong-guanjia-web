/* 应用外壳：侧边栏 / 路由 / 首页 / 全局状态 */
const APP = (() => {
  const GROUPS = [
    { name: '工作台', items: [['home', '首页']] },
    { name: '管人', items: [['staff', '员工档案'], ['contract', '合同管理'], ['attend', '考勤工时'], ['payroll', '薪资'], ['social', '社保'], ['cert', '证照资质']] },
    { name: '法务风险', items: [['risk', '风险清单'], ['riskrule', '规则配置'], ['riskconfirm', '确认台账'], ['risktodo', '风险处置'], ['survey', '自检问卷'], ['ai', 'AI 问答']] },
    { name: '流程', items: [['apply', '申请中心'], ['approve', '审批中心'], ['flowdesign', '流程编排']] },
    { name: '系统', items: [['role', '角色权限'], ['member', '成员账户'], ['invite', '邀请成员'], ['layout', '模块编排'], ['audit', '审计日志'], ['dataio', '数据导入导出'], ['setting', '系统设置']] },
  ];

  /* ---------- 首页 ---------- */
  PAGES.home = {
    title: '首页',
    async render(c) {
      const [s, h] = await Promise.all([API.stats().catch(() => ({})), API.health().catch(() => ({}))]);
      c.innerHTML = `
        <div class="card">
          <h2>${UI.esc(s.companyName || h.companyName || '企业用工合规管理')}</h2>
          <p style="color:var(--muted);margin:0">
            录入员工、合同、考勤、薪资、社保数据 → 系统按 116 条规则自动扫描 → 风险下钻到具体人 → 派发整改 → AI 解读。
          </p>
        </div>
        <div class="stat-grid">
          <div class="stat"><b>${s.employees ?? 0}</b><span>在职员工</span></div>
          <div class="stat"><b>${s.contracts ?? 0}</b><span>劳动合同</span></div>
          <div class="stat alert"><b>${s.risks ?? 0}</b><span>待关注风险点</span></div>
          <div class="stat"><b>${s.todo ?? 0}</b><span>待处置</span></div>
        </div>
        <div class="card">
          <h2>快速开始</h2>
          <div class="toolbar">
            <button class="btn primary" onclick="location.hash='#/risk'">查看风险清单</button>
            <button class="btn" onclick="location.hash='#/staff'">录入员工</button>
            <button class="btn" onclick="location.hash='#/survey'">做自检问卷</button>
            <button class="btn" onclick="location.hash='#/ai'">问 AI 劳动法问题</button>
            <button class="btn" onclick="location.hash='#/setting'">配置 AI 密钥</button>
          </div>
        </div>
        <div class="card">
          <h2>系统状态</h2>
          <table class="tbl">
            <tr><td style="width:160px;color:var(--muted)">大模型（AI）</td><td>${h.llmEnabled
              ? '<span class="tag green">已接入 ' + UI.esc(h.model) + '</span>'
              : '<span class="tag orange">未配置密钥，本地规则引擎兜底</span>'}</td></tr>
            <tr><td style="color:var(--muted)">劳动法知识库</td><td>${h.corpusSize ?? 0} 条（法条 / 规则 / 风险点）</td></tr>
            <tr><td style="color:var(--muted)">风险规则</td><td>116 条（10 条由数据自动算出，105 条需台账或问卷）</td></tr>
            <tr><td style="color:var(--muted)">自检环节</td><td>${h.quizCategories ?? 0} 个</td></tr>
          </table>
        </div>
        <div class="notice">
          ⚠️ 本工具是把需要律师的人筛出来的「筛子」，不替代律师下结论；结论仅供参考，不构成正式法律意见。
        </div>`;
    },
  };

  /* ---------- 侧边栏 ---------- */
  async function renderNav() {
    let s = {};
    try {
      s = await API.settings();
    } catch (e) {}
    const hidden = s.hiddenModules || [];
    const order = s.moduleOrder || [];
    const nav = document.getElementById('sideNav');
    nav.innerHTML = GROUPS.map((g) => {
      const items = g.items
        .filter((it) => !hidden.includes(it[0]))
        .sort((a, b) => {
          const ia = order.indexOf(a[0]);
          const ib = order.indexOf(b[0]);
          return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
        });
      if (!items.length) return '';
      return `<div class="nav-group">${g.name}</div>` +
        items.map((it) => `<div class="nav-item" data-key="${it[0]}">${it[1]}</div>`).join('');
    }).join('');
    nav.querySelectorAll('.nav-item').forEach((el) => {
      el.onclick = () => (location.hash = '#/' + el.dataset.key);
    });
    document.getElementById('sideCompany').textContent = s.companyName || '企业用工合规管理';
  }

  /* ---------- 状态灯 ---------- */
  async function loadHealth() {
    try {
      const h = await API.health();
      const badge = document.getElementById('statusBadge');
      badge.classList.remove('ok', 'off');
      if (h.llmEnabled) {
        badge.classList.add('ok');
        document.getElementById('statusText').textContent = 'AI 已接入 · ' + h.model;
      } else {
        badge.classList.add('off');
        document.getElementById('statusText').textContent = 'AI 未配置 · 本地规则引擎';
      }
    } catch (e) {
      document.getElementById('statusText').textContent = '服务未连接';
    }
  }

  /* ---------- 路由 ---------- */
  async function route() {
    const key = (location.hash || '#/home').replace('#/', '') || 'home';
    const page = PAGES[key] || PAGES.home;
    document.title = '用工管家 · ' + page.title;
    document.getElementById('pageTitle').textContent = page.title;
    document.querySelectorAll('.nav-item').forEach((el) =>
      el.classList.toggle('active', el.dataset.key === key)
    );
    const c = document.getElementById('content');
    c.innerHTML = '<div class="card">加载中…</div>';
    try {
      await page.render(c);
    } catch (e) {
      c.innerHTML = `<div class="card"><h2>页面出错</h2><p>${UI.esc(e.message)}</p></div>`;
    }
  }

  function init() {
    document.getElementById('btnMenu').onclick = () =>
      document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('btnQuickScan').onclick = () => (location.hash = '#/risk');
    window.addEventListener('hashchange', route);
    renderNav().then(route);
    loadHealth();
  }

  return { init, loadHealth, renderNav, route };
})();

document.addEventListener('DOMContentLoaded', APP.init);
