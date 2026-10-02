/* 应用外壳：免登录版 —— 侧边栏 / 路由 / 首页 */
const APP = (() => {
  // 检测系统只保留与"风险检测"直接相关的模块；免登录版去掉「成员账户」
  const GROUPS = [
    { name: '结论', items: [['home', '检测概览'], ['people', '员工风险画像'], ['risk', '风险清单']] },
    { name: '数据填入', items: [['staff', '员工档案'], ['contract', '合同信息'], ['attend', '考勤工时'], ['payroll', '薪资'], ['social', '社保'], ['cert', '证件资质'], ['dataio', '数据导入']] },
    { name: '风险确认', items: [['riskconfirm', '合规自查'], ['riskrule', '规则配置'], ['regionset', '地区与判定标准'], ['ai', 'AI 问答']] },
    { name: '系统', items: [['setting', '系统设置']] },
  ];

  /* ---------- 首页 ---------- */
  PAGES.home = {
    title: '首页',
    async render(c) {
      const [s, h, pe, rd, confList] = await Promise.all([
        API.stats().catch(() => ({})),
        API.health().catch(() => ({})),
        API.riskByEmployee().catch(() => ({ employees: [] })),
        API.rules().catch(() => ({ rules: [] })),
        API.list('confirms').catch(() => []),
      ]);
      const emps = pe.employees || [];
      const affected = emps.filter((e) => e.riskCount > 0).length;
      const high = emps.reduce((x, e) => x + (e.highCount || 0), 0);
      // 覆盖度：全部规则里能由数据测算的条数 + 需自查的条数、已确认条数
      const allRules = rd.rules || [];
      const autoCnt = allRules.filter((r) => r.level === 'auto').length;
      const askCnt = allRules.length - autoCnt;
      const confCnt = (confList || []).length;

      c.innerHTML = `
        <div class="demo-banner">
          <span>📌 这是<b>演示数据</b>，方便直接体验。数据只存在您的浏览器里（localStorage），不上传服务器。</span>
          <span class="demo-banner-btns">
            <button class="btn small danger" id="btnWipe">清空演示数据</button>
            <button class="btn small" id="btnReseed">重新载入演示数据</button>
          </span>
        </div>
        <div class="card">
          <h2>用工风险检测</h2>
          <p style="color:var(--muted);margin:0">
            导入或录入用工数据 → 系统自动测算每个人身上的用工风险 → 算不出的走合规自查 → 给出整改建议。
          </p>
        </div>
        <div class="stat-grid">
          <div class="stat"><b>${emps.length}</b><span>员工总数</span></div>
          <div class="stat alert"><b>${affected}</b><span>存在风险的员工</span></div>
          <div class="stat alert"><b>${high}</b><span>高危问题</span></div>
          <div class="stat"><b>${s.risks ?? 0}</b><span>风险项合计</span></div>
        </div>
        <div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span style="font-size:13.5px">📊 检测覆盖：<b>${autoCnt}</b> 条已由数据自动测算，<b>${askCnt}</b> 条需合规自查（已确认 <b>${confCnt}</b> / ${askCnt}）</span>
          <div class="spacer"></div>
          <button class="btn small" onclick="location.hash='#/riskconfirm'">去合规自查</button>
        </div>
        <div class="card">
          <h2>开始检测</h2>
          <div class="toolbar">
            <button class="btn primary" onclick="location.hash='#/people'">看员工风险画像</button>
            <button class="btn" onclick="location.hash='#/dataio'">导入数据</button>
            <button class="btn" onclick="location.hash='#/riskconfirm'">合规自查</button>
            <button class="btn" onclick="location.hash='#/ai'">问 AI 劳动法问题</button>
          </div>
        </div>
        <div class="card">
          <h2>系统状态</h2>
          <table class="tbl">
            <tr><td style="width:160px;color:var(--muted)">大模型（AI）</td><td>${h.llmEnabled
              ? '<span class="tag green">已接入 ' + UI.esc(h.model) + '</span>'
              : '<span class="tag orange">未配置密钥，本地规则引擎兜底</span>'}</td></tr>
            <tr><td style="color:var(--muted)">劳动法知识库</td><td>${h.corpusSize ?? 0} 条（法条 / 规则 / 风险点）</td></tr>
            <tr><td style="color:var(--muted)">风险规则</td><td>${(() => {
              const all = (window.Engine.RULES || []).concat(window.Engine.EXTRA_RULE_LIST || []);
              const auto = all.filter((r) => r.level === 'auto').length;
              return `${all.length} 条（其中 ${auto} 条可由数据自动测算，其余走合规自查台账或问卷）`;
            })()}</td></tr>
            <tr><td style="color:var(--muted)">数据存储</td><td>仅存在本浏览器（localStorage），不上传服务器</td></tr>
          </table>
        </div>`;

      /* ---- 演示数据横幅按钮 ---- */
      c.querySelector('#btnWipe').onclick = () =>
        UI.confirmBox('将清空本浏览器里的全部数据（员工/合同/考勤/薪资/社保/证照/问卷答案全部清空，从白板开始），确定？', async () => {
          const d = await API.exportAll();
          ['employees', 'contracts', 'attendances', 'payrolls', 'socials', 'certs'].forEach((k) => (d[k] = []));
          d.confirms = {};
          d.surveys = {};
          d.audit = [];
          await API.importAll(d);
          UI.toast('已清空，从空白开始');
          setTimeout(() => location.reload(), 600);
        });
      c.querySelector('#btnReseed').onclick = () =>
        UI.confirmBox('将丢弃当前全部改动，重新载入 36 人演示数据（含 17 类预埋风险），确定？', async () => {
          await API.reset();
          UI.toast('已重新载入演示数据');
          setTimeout(() => location.reload(), 600);
        });
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
    document.getElementById('sideCompany').textContent = '用工风险检测系统';
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

    // 自检问卷已并入「合规自查」，旧链接自动指向合并后的页面
    let page = PAGES[key] || PAGES.home;
    if (key === 'survey') page = PAGES.riskconfirm;
    document.title = '小哲用工风险检测 · ' + page.title;
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

    loadHealth();
    renderNav();
    route();
  }

  return { init, loadHealth, renderNav, route };
})();

document.addEventListener('DOMContentLoaded', APP.init);
