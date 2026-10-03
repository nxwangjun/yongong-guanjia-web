/* 应用外壳：免登录版 —— 侧边栏 / 路由 / 首页 */
const APP = (() => {
  // 检测系统只保留与"风险检测"直接相关的模块；免登录版去掉「成员账户」
  const GROUPS = [
    { name: '结论', items: [['home', '风险概览'], ['people', '员工风险画像'], ['risk', '用工风险清单']] },
    { name: '数据填入', items: [['staff', '员工档案'], ['contract', '合同信息'], ['attend', '考勤工时'], ['payroll', '薪资报酬'], ['social', '社保信息'], ['cert', '证件资质'], ['dataio', '数据导入']] },
    { name: '风险确认', items: [['riskconfirm', '合规自查'], ['regionset', '判定阈值'], ['ai', 'AI 问答']] },
    { name: '系统设置', items: [['riskrule', '规则配置'], ['setting', '系统设置']] },
  ];

  /* ---------- 首页（风险概览） ---------- */
  PAGES.home = {
    title: '风险概览',
    async render(c) {
      const [scanData, h, pe, rd, confList] = await Promise.all([
        API.scan().catch(() => ({ items: [] })),
        API.health().catch(() => ({})),
        API.riskByEmployee().catch(() => ({ employees: [] })),
        API.rules().catch(() => ({ rules: [] })),
        API.list('confirms').catch(() => []),
      ]);
      const items = (scanData.items || []).slice();
      const emps = pe.employees || [];
      // 覆盖度：全部规则里能由数据测算的条数 + 需自查的条数、已确认条数
      const allRules = rd.rules || [];
      const autoCnt = allRules.filter((r) => r.level === 'auto').length;
      const askCnt = allRules.length - autoCnt;
      const confCnt = (confList || []).length;

      /* ---- 风险概要：基于员工风险画像 + 风险清单扫出的问题自动总结 ---- */
      const sevRank = (s) => (s === '高' ? 0 : s === '中' ? 1 : 2);
      const highItems = items.filter((i) => sevRank(i.sev) === 0);
      const midItems = items.filter((i) => sevRank(i.sev) === 1);
      const lowItems = items.filter((i) => sevRank(i.sev) === 2);
      const peopleCnt = items.reduce((s, i) => s + (i.people || []).length, 0);
      const affected = emps.filter((e) => e.riskCount > 0).length;
      // 按类别聚合
      const catMap = {};
      items.forEach((i) => {
        const k = i.catLabel || i.cat || '其他';
        if (!catMap[k]) catMap[k] = { cnt: 0, high: 0, risks: [] };
        catMap[k].cnt++;
        if (sevRank(i.sev) === 0) catMap[k].high++;
        catMap[k].risks.push(i.risk);
      });
      const cats = Object.keys(catMap)
        .map((k) => ({ name: k, ...catMap[k] }))
        .sort((a, b) => b.high - a.high || b.cnt - a.cnt);
      const topHigh = highItems.slice(0, 3);

      let summaryHtml;
      if (!items.length) {
        summaryHtml = `<p style="color:var(--muted);margin:0">暂未扫出风险。先去「数据填入」录入或导入员工数据，系统会自动测算；算不出的项目到「合规自查」逐条确认。</p>`;
      } else {
        // 整改优先级建议：按"先止血（高危）→ 再补齐（中危）→ 后规范（低危）"给行动顺序
        const priority = [];
        if (highItems.length) priority.push(`<b style="color:#dc2626">第一步</b> 先处理 ${highItems.length} 类高危问题（${topHigh.map((i) => UI.esc(i.risk)).join('；')}${highItems.length > 3 ? ' 等' : ''}），这类最容易引发仲裁赔偿`);
        if (midItems.length) priority.push(`<b style="color:#d97706">第二步</b> 补齐 ${midItems.length} 类中危事项的手续与台账，防止小毛病累积成证据链`);
        if (lowItems.length) priority.push(`<b style="color:#6b7280">第三步</b> 规范 ${lowItems.length} 类低风险事项，纳入日常管理即可`);
        summaryHtml = `
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px">
            <div class="stat"><b>${items.length}</b><span>风险类别合计</span></div>
            <div class="stat alert"><b>${highItems.length}</b><span>高危（优先处理）</span></div>
            <div class="stat"><b>${midItems.length}</b><span>中危</span></div>
            <div class="stat"><b>${lowItems.length}</b><span>低危</span></div>
          </div>
          <p style="margin:0 0 10px">
            本次共扫出 <b>${items.length}</b> 类用工风险，其中 <b style="color:#dc2626">${highItems.length} 类建议优先处理</b>，
            涉及 <b>${peopleCnt}</b> 人次（${affected} 名员工身上有至少一类风险）。
          </p>
          <p style="margin:0 0 6px"><b>问题集中在：</b>${cats
            .map((k) => `${UI.esc(k.name)} ${k.cnt} 类${k.high ? `（含优先处理 ${k.high} 类）` : ''}`)
            .join('、')}</p>
          <div style="background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin:10px 0">
            <b>整改建议（按优先级）：</b>
            ${priority.map((p) => `<p style="margin:6px 0 0;font-size:13.5px">${p}</p>`).join('')}
          </div>
          <p style="margin:0 0 6px;color:var(--muted);font-size:12.5px">⚠️ 以上为系统按录入数据自动生成的初步自查提示，不构成正式法律意见；具体处置建议结合贵司实际情况咨询律师。</p>
          <div class="toolbar" style="margin-top:8px">
            <button class="btn primary" onclick="location.hash='#/risk'">去用工风险清单逐条处理</button>
            <button class="btn" onclick="location.hash='#/people'">看员工风险画像</button>
          </div>`;
      }

      c.innerHTML = `
        <div class="demo-banner">
          <span>📌 这是<b>演示数据</b>，方便直接体验。数据只存在您的浏览器里（localStorage），不上传服务器。</span>
          <span class="demo-banner-btns">
            <button class="btn small danger" id="btnWipe">清空演示数据</button>
            <button class="btn small" id="btnReseed">重新载入演示数据</button>
          </span>
        </div>
        <div class="card">
          <h2>风险概要</h2>
          ${summaryHtml}
        </div>
        <div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span style="font-size:13.5px">📊 检测覆盖：<b>${autoCnt}</b> 条已由数据自动测算，<b>${askCnt}</b> 条需合规自查（已确认 <b>${confCnt}</b> / ${askCnt}）</span>
          <div class="spacer"></div>
          <button class="btn small" onclick="location.hash='#/riskconfirm'">去合规自查</button>
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
