/* 应用外壳：免登录版 —— 侧边栏 / 路由 / 首页 */
const APP = (() => {
  // 检测系统只保留与"风险检测"直接相关的模块；免登录版去掉「成员账户」
  const GROUPS = [
    { name: '结论', items: [['home', '风险概览'], ['people', '员工风险画像'], ['risk', '用工风险清单']] },
    { name: '数据填入', items: [['staff', '员工档案'], ['contract', '合同信息'], ['attend', '考勤工时'], ['payroll', '薪资报酬'], ['social', '社保信息'], ['cert', '证件资质'], ['dataio', '数据导入']] },
    { name: '风险确认', items: [['riskconfirm', '合规自查'], ['regionset', '判定阈值'], ['ai', 'AI 问答']] },
    { name: '系统信息', items: [['riskrule', '规则配置'], ['setting', '系统信息']] },
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
        const steps = [];
        if (highItems.length) steps.push({ cls: 'red', label: '第一步', text: `先处理 <b>${highItems.length}</b> 类高危问题：${topHigh.map((i) => UI.esc(i.risk)).join('；')}${highItems.length > 3 ? ' 等' : ''}。这类最容易引发仲裁赔偿。` });
        if (midItems.length) steps.push({ cls: 'amber', label: '第二步', text: `补齐 <b>${midItems.length}</b> 类中危事项的手续与台账，防止小毛病累积成证据链。` });
        if (lowItems.length) steps.push({ cls: 'gray', label: '第三步', text: `规范 <b>${lowItems.length}</b> 类低风险事项，纳入日常管理即可。` });
        summaryHtml = `
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px">
            <div class="stat"><b>${items.length}</b><span>风险类别合计</span></div>
            <div class="stat alert"><b>${highItems.length}</b><span>高危（优先处理）</span></div>
            <div class="stat"><b>${midItems.length}</b><span>中危</span></div>
            <div class="stat"><b>${lowItems.length}</b><span>低危</span></div>
          </div>
          <div class="legend">
            分级：
            <span class="lg red">高危 · 立即处理</span>
            <span class="lg amber">中危 · 限期整改</span>
            <span class="lg gray">低危 · 日常规范</span>
            <span class="lg-link" id="btnSevHelp">分级依据 ▸</span>
          </div>
          <p style="margin:0 0 10px">
            本次共扫出 <b>${items.length}</b> 类用工风险，其中 <b style="color:#dc2626">${highItems.length} 类建议优先处理</b>，
            涉及 <b>${peopleCnt}</b> 人次（${affected} 名员工身上有至少一类风险）。
          </p>
          <p style="margin:0 0 2px;font-size:13px;color:var(--muted)"><b style="color:var(--text)">问题集中在：</b></p>
          <div class="cat-chips">${cats
            .map((k) => `<span class="cat-chip">${UI.esc(k.name)} <b>${k.cnt}</b> 类${k.high ? ` · <span class="hi">高危 ${k.high}</span>` : ''}</span>`)
            .join('')}</div>
          <p style="margin:14px 0 2px;font-size:13px;color:var(--muted)"><b style="color:var(--text)">整改建议（按优先级）：</b></p>
          <div class="steps" style="grid-template-columns:repeat(${steps.length},1fr)">
            ${steps.map((s, i) => `<div class="step"><span class="no ${s.cls}">${i + 1}</span>${s.text}</div>`).join('')}
          </div>
          </div>`;
      }

      c.innerHTML = `
        <div class="demo-banner">
          <span>📌 这是<b>演示数据</b>，方便直接体验。选择清空演示数据后，填入真实信息即可自动检测用工风险。</span>
          <span class="demo-banner-btns">
            <button class="btn small danger" id="btnWipe">清空演示数据</button>
            <button class="btn small" id="btnReseed">重新载入演示数据</button>
          </span>
        </div>
        <div class="card">
          <h2>风险概要</h2>
          ${summaryHtml}
        </div>
        <div class="card">
          <h2>劳动用工分析意见书</h2>
          <p style="color:var(--muted);font-size:13px;margin:0 0 10px">
            根据当前扫描结果自动生成的分析意见书全文（含评估概况、分级风险明细、整改建议、涉及法条全文），
            可一键复制到 Word 或微信发送。${items.length ? '' : '当前未扫出风险，生成的是「未发现问题」版本。'}
          </p>
          <div class="toolbar" style="margin:0">
            <button class="btn primary" id="btnOpinion">查看意见书全文</button>
            <button class="btn" id="btnCopyOpinion">一键复制意见书</button>
          </div>
        </div>
        <div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span style="font-size:13.5px">📊 检测覆盖：<b>${autoCnt}</b> 条已由数据自动测算，<b>${askCnt}</b> 条需合规自查（已确认 <b>${confCnt}</b> / ${askCnt}）</span>
          <div class="spacer"></div>
          <button class="btn small" onclick="location.hash='#/riskconfirm'">去合规自查</button>
        </div>`;

      /* ---- 意见书：查看全文 / 一键复制 ---- */
      const empTotal = (await API.list('employees').catch(() => [])).filter((e) => e.status !== 'left').length;
      const opText = buildOpinion(items, { empTotal, peopleCnt, affected });
      c.querySelector('#btnOpinion').onclick = () => {
        UI.modal(
          '劳动用工分析意见书（全文）',
          `<textarea id="opText" readonly style="width:100%;height:52vh;border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.7;resize:vertical">${UI.esc(opText)}</textarea>`,
          [
            { text: '一键复制', cls: 'primary', onClick: (box) => copyText(opText, box.querySelector('#opText')) },
            { text: '关闭', onClick: () => UI.closeModal() },
          ]
        );
      };
      c.querySelector('#btnCopyOpinion').onclick = () => copyText(opText, null);

      /* ---- 分级依据说明（图例旁的「分级依据 ▸」） ---- */
      const sevHelpBtn = c.querySelector('#btnSevHelp');
      if (sevHelpBtn) sevHelpBtn.onclick = () =>
        UI.modal(
          '风险分级依据',
          `<div style="font-size:13.5px;line-height:1.9">
            <p style="margin:0 0 10px"><b style="color:#dc2626">高危 · 应当立即处理</b><br/>
            直接违反法律强制性规定，单人/单次赔付或处罚金额显著（如未签合同二倍工资、违法解除赔偿金、补缴社保并滞纳金），事后补救难以完全消除责任。</p>
            <p style="margin:0 0 10px"><b style="color:#d97706">中危 · 建议限期整改</b><br/>
            虽违反强制性规定，但金额有限，可通过补发、补签、补缴、补休等方式基本挽回。</p>
            <p style="margin:0"><b style="color:#6b7280">低危 · 纳入日常管理规范</b><br/>
            以留痕、公示、文本规范为主的合规要求，通常无直接金钱给付责任。</p>
          </div>`,
          [{ text: '知道了', cls: 'primary', onClick: () => UI.closeModal() }]
        );

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

  /* ---------- 分析意见书生成（格式参照小毅劳资风险自检器法律分析意见书） ---------- */
  const SEV_META = [
    { key: '高', num: '（一）', label: '高危', note: '直接违反强制性规定，单人/单次赔付或处罚金额显著（如二倍工资、赔偿金、补缴社保并滞纳金），事后补救难以完全消除责任，应当立即处理。' },
    { key: '中', num: '（二）', label: '中危', note: '虽违反强制性规定，但金额有限，可通过补发、补签、补缴、补休等方式基本挽回，建议限期整改。' },
    { key: '低', num: '（三）', label: '低危', note: '以留痕、公示、文本规范为主的合规要求，通常无直接金钱给付责任，建议纳入日常管理规范。' },
  ];

  function buildOpinion(items, meta) {
    meta = meta || {};
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    const dateStr = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const groups = SEV_META.map((m) => ({ ...m, items: items.filter((i) => i.sev === m.key) })).filter((g) => g.items.length);
    const high = items.filter((i) => i.sev === '高').length;
    const mid = items.filter((i) => i.sev === '中').length;
    const low = items.filter((i) => i.sev === '低').length;

    // 文头
    let t = '劳动用工风险分析意见书\n\n';
    t += '出具方：小哲用工风险检测系统（自助检测工具）\n';
    t += '生成日期：' + dateStr + '\n';
    if (meta.empTotal) t += '员工规模：' + meta.empTotal + ' 人（在职）\n';
    t += '\n';

    // 一、评估概况
    t += '一、评估概况\n';
    if (!items.length) {
      t += '本次检测未发现劳动用工风险事项。\n';
    } else {
      t += `本次自查共命中 ${items.length} 项风险（高危 ${high} · 中危 ${mid} · 低危 ${low}），涉及 ${meta.peopleCnt} 人次（${meta.affected} 名员工存在至少一类风险）。以下按风险等级从高到低分类列明具体问题、法律后果与整改意见。\n`;
    }
    t += '评级说明：高危——直接违反强制性规定，且单人/单次赔付或处罚金额显著（达数月工资或具惩罚性倍数），难以通过事后补救完全消除责任（如未签合同二倍工资、违法解除赔偿金、未付加班费、工伤全赔、童工、安全生产/监察类行政罚款）；中危——虽违反强制性规定，但单人/单次金额有限，且可通过补休、补发、补签、补缴等事后方式基本挽回（如未休年休假、合法解除支付经济补偿、程序类行政罚款、规章公示瑕疵）；低危——以留痕、公示、文本规范为主的合规要求，通常无直接金钱给付责任（如公示形式、培训记录、文本留存）。\n\n';

    if (items.length) {
      // 二、企业用工风险情况（按危级分类：高危 → 中危 → 低危）
      t += '二、企业用工风险情况\n';
      groups.forEach((g) => {
        t += `${g.num}${g.label}风险情况（${g.items.length} 项）\n`;
        t += `性质：${g.note}\n`;
        g.items.forEach((it, i) => {
          t += `${i + 1}. 【${it.catLabel || it.cat || '其他'}】${it.risk}`;
          if (it.source === '台账/问卷') t += it.answer === 'unsure' ? '（自查结论：待核实）' : '（自查结论：未做到）';
          t += '\n';
          (it.people || []).slice(0, 10).forEach((pp) => {
            t += `   涉及人员：${pp.name}（${pp.dept || '未填部门'}）——${pp.detail}\n`;
          });
          if ((it.people || []).length > 10) t += `   涉及人员：共 ${it.people.length} 人，上列前 10 人，完整明细见系统「用工风险清单」。\n`;
          if (it.consequence) t += `   法律后果：${it.consequence}\n`;
          if ((it.remedy || []).length) t += `   整改意见：${it.remedy.map((r, j) => `${j + 1}) ${r}`).join('；')}\n`;
          if ((it.law || []).length) t += `   法律依据：${it.law.map((l) => l.ref).join('；')}（全文见附件）\n`;
        });
        t += '\n';
      });

      // 三、后续整改指引（按优先级）
      t += '三、后续整改指引（按优先级）\n';
      if (high) t += `第一步：立即处理 ${high} 类高危事项，固定证据、逐项整改，避免进入仲裁程序后陷入被动。\n`;
      if (mid) t += `第二步：限期补齐 ${mid} 类中危事项的手续与台账（补签、补发、补缴、补休）。\n`;
      if (low) t += `第三步：将 ${low} 类低危事项纳入日常管理规范，形成留痕习惯。\n`;
      t += '\n';

      // 附件：涉及法律依据全文
      const seen = {};
      const laws = [];
      items.forEach((it) =>
        (it.law || []).forEach((l) => {
          if (l.ref && !seen[l.ref]) {
            seen[l.ref] = 1;
            laws.push(l);
          }
        })
      );
      if (laws.length) {
        t += '附件：涉及法律依据全文\n';
        laws.forEach((l) => {
          t += `◆ ${l.ref}\n　${(l.text || '').replace(/\n/g, '\n　')}\n\n`;
        });
      }
    }

    return t;
  }
  window.buildOpinion = buildOpinion;

  /* ---------- 复制到剪贴板（Clipboard API + textarea 兜底） ---------- */
  function copyText(text, ta) {
    const done = () => UI.toast('已复制，可直接粘贴到 Word / 微信');
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => legacyCopy(text, ta, done));
    } else {
      legacyCopy(text, ta, done);
    }
  }
  function legacyCopy(text, ta, done) {
    let el = ta;
    let temp = false;
    if (!el) {
      el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      temp = true;
    }
    el.select();
    try {
      document.execCommand('copy');
      done();
    } catch (e) {
      UI.toast('复制失败，请手动全选复制');
    }
    if (temp) document.body.removeChild(el);
  }

  /* ---------- 侧边栏 ---------- */
  async function renderNav() {
    let s = {};
    try {
      s = (await API.settings()).settings || {};
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
