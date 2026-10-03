/* 法务风险模块：风险清单 / 规则配置 / 合规自查 / AI 问答 / 自检问卷 */
window.PAGES = window.PAGES || {};

function sevRank(s) {
  return s === '高' ? 0 : s === '中' ? 1 : 2;
}

/* ============ 用工风险清单 ============ */
PAGES.risk = {
  title: '用工风险清单',
  async render(c) {
    c.innerHTML = `<div class="card">正在扫描…</div>`;
    let data;
    try {
      data = await API.scan();
    } catch (e) {
      c.innerHTML = `<div class="card">扫描失败：${UI.esc(e.message)}</div>`;
      return;
    }
    const items = (data.items || []).slice().sort((a, b) => sevRank(a.sev) - sevRank(b.sev) || b.count - a.count);
    const firstCount = items.filter((i) => sevRank(i.sev) === 0).length;
    const people = items.reduce((s, i) => s + (i.people || []).length, 0);
    // 未设最低工资时低工资类规则静默不判，显眼提示而不是无声跳过
    const cfg = ((await API.settings().catch(() => ({}))) || {}).settings || {};
    const wageHint = !Number(cfg.minWage)
      ? `<div class="notice">⚠️ 还没有设置所在地区/最低工资，「低于最低工资」「试用期工资不达标」类检测未启用。<a href="#/regionset" style="color:inherit;text-decoration:underline">去「判定阈值」设置 →</a></div>`
      : '';

    c.innerHTML = `
      ${wageHint}
      <div class="stat-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:14px">
        <div class="stat"><b>${items.length}</b><span>需关注风险点</span></div>
        <div class="stat alert"><b>${firstCount}</b><span>建议优先处理</span></div>
        <div class="stat"><b>${people}</b><span>涉及人次</span></div>
        <div class="stat"><b>${items.filter((i) => i.source === '数据扫描').length}</b><span>由数据算出</span></div>
      </div>
      <div class="card">
        <div class="toolbar">
          <h2 style="margin:0">用工风险清单（按处理优先级排序）</h2>
          <div class="spacer"></div>
          <button class="btn" id="btnRescan">重新扫描</button>
        </div>
        <div id="riskList"></div>
        ${items.length ? '' : '<p style="color:var(--muted)">未发现风险。可先录入员工/合同/薪资数据，或在「合规自查」里补充系统算不出的项目。</p>'}
      </div>`;

    const listEl = c.querySelector('#riskList');
    listEl.innerHTML = items.map((it, idx) => riskCard(it, idx, firstCount)).join('');

    c.querySelector('#btnRescan').onclick = () => PAGES.risk.render(c);

    // 展开/收起
    listEl.querySelectorAll('[data-toggle]').forEach((b) => {
      b.onclick = () => {
        const body = listEl.querySelector(`#body-${b.dataset.toggle}`);
        body.classList.toggle('show');
        b.textContent = body.classList.contains('show') ? '收起' : '展开详情';
      };
    });

    // AI 解读
    listEl.querySelectorAll('[data-ai]').forEach((b) => {
      b.onclick = async () => {
        const it = items[b.dataset.ai];
        const box = listEl.querySelector(`#ai-${b.dataset.ai}`);
        box.classList.add('show');
        box.textContent = 'AI 正在结合法条解读…';
        b.disabled = true;
        try {
          const r = await API.explain(it);
          box.textContent = r.text + '\n\n（' + r.model + '）';
        } catch (e) {
          box.textContent = '解读失败：' + e.message;
        }
        b.disabled = false;
      };
    });
  },
};

function riskCard(it, idx, firstCount) {
  const first = sevRank(it.sev) === 0;
  const people = (it.people || [])
    .map((p) => `<li>${UI.esc(p.name)}（${UI.esc(p.dept || '未填部门')}）：${UI.esc(p.detail)}</li>`)
    .join('');
  const law = (it.law || [])
    .map((l) => `<div class="law-text"><b>${UI.esc(l.ref)}</b><br/>${UI.esc(l.text)}</div>`)
    .join('');
  const remedy = (it.remedy || []).map((r, i) => `${i + 1}. ${UI.esc(r)}`).join('<br/>');

  return `
  <div class="risk-item ${first ? 'first' : ''}">
    <div class="ri-head">
      <span class="tag blue">${UI.esc(it.catLabel || it.cat)}</span>
      <span class="ri-title">${idx + 1}. ${UI.esc(it.risk)}</span>
      ${first ? '<span class="tag red">建议优先处理</span>' : ''}
      <span class="ri-meta">${UI.esc(it.source)}${it.count ? ' · 命中 ' + it.count + ' 人' : ''}</span>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn small" data-toggle="${idx}">展开详情</button>
      <button class="btn small" data-ai="${idx}">AI 解读</button>
    </div>
    <div class="ri-body" id="body-${idx}">
      ${people ? `<b>涉及人员：</b><ul class="people-list">${people}</ul>` : ''}
      ${it.answer ? `<div style="margin-top:6px"><b>台账/问卷结论：</b>${it.answer === 'no' ? '未做到' : '待核实'}</div>` : ''}
      ${it.consequence ? `<div style="margin-top:6px"><b>可能的后果：</b>${UI.esc(it.consequence)}</div>` : ''}
      ${remedy ? `<div style="margin-top:6px"><b>整改要点：</b><br/>${remedy}</div>` : ''}
      ${law ? `<div style="margin-top:6px"><b>法律依据：</b>${law}</div>` : ''}
    </div>
    <div class="ai-box" id="ai-${idx}"></div>
  </div>`;
}

/* ============ 规则配置 ============ */
PAGES.riskrule = {
  title: '规则配置',
  async render(c) {
    const d = await API.rules();
    const rules = d.rules || [];
    c.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <h2 style="margin:0">规则配置（${rules.length} 条）</h2>
          <div class="spacer"></div>
          <input class="search" id="kw" placeholder="搜索风险点…" />
        </div>
        <p style="color:var(--muted);font-size:13px;margin:0 0 10px">
          停用后该条不参与扫描。共 ${rules.filter((r) => r.level === 'auto').length} 条由数据自动算出，
          ${rules.filter((r) => r.level !== 'auto').length} 条需台账确认或问卷作答${rules.filter((r) => r.level === 'hybrid').length ? `（含 ${rules.filter((r) => r.level === 'hybrid').length} 条混合方式，先由数据初筛再走确认）` : ''}。
        </p>
        <table class="tbl">
          <thead><tr><th style="width:60px">启用</th><th>风险点</th><th style="width:90px">分类</th><th style="width:80px">方式</th></tr></thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>`;
    const tb = c.querySelector('#tbody');
    const draw = (kw) => {
      const list = kw
        ? rules.filter((r) => (r.risk || '').includes(kw) || (r.id || '').includes(kw))
        : rules;
      tb.innerHTML = list
        .map(
          (r) => `<tr>
            <td><input type="checkbox" data-id="${r.id}" ${r.enabled ? 'checked' : ''} /></td>
            <td>${UI.esc(r.risk)}<br/><small style="color:var(--muted)">${UI.esc(r.id)}</small></td>
            <td>${UI.esc(r.catLabel || r.cat)}</td>
            <td>${r.level === 'auto' ? '数据算出' : r.level === 'hybrid' ? '混合' : '台账/问卷'}</td>
          </tr>`
        )
        .join('');
      tb.querySelectorAll('[data-id]').forEach((cb) => {
        cb.onchange = async () => {
          await API.setRule(cb.dataset.id, cb.checked);
          UI.toast(cb.checked ? '已启用' : '已停用');
        };
      });
    };
    draw('');
    c.querySelector('#kw').oninput = (e) => draw(e.target.value.trim());
  },
};

/* ============ 法务确认台账 ============ */
PAGES.riskconfirm = {
  title: '合规自查',
  async render(c) {
    const [rd, dbConfirms] = await Promise.all([API.rules(), API.list('confirms')]);
    const rules = (rd.rules || []).filter((r) => r.level !== 'auto');
    const answered = {};
    dbConfirms.forEach((x) => (answered[x.ruleId] = x));

    c.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <h2 style="margin:0">合规自查（${rules.length} 条）</h2>
          <div class="spacer"></div>
          <input class="search" id="kw" placeholder="搜索…" />
        </div>
        <p style="color:var(--muted);font-size:13px;margin:0 0 10px">
          系统算不出的项目，在这里逐条勾选。
          勾选完点页面底部「提交自查结果」，会自动跳到风险清单并重算出最新结论：
          答「没做到」或「待核实」的会进入风险清单，答「不适用」的不产生风险。
        </p>
        <div id="list"></div>
        <div class="toolbar" style="margin-top:14px">
          <span id="pendCnt" style="color:var(--muted);font-size:13px"></span>
          <div class="spacer"></div>
          <button class="btn primary" id="btnSubmit">提交自查结果</button>
        </div>
      </div>`;
    const listEl = c.querySelector('#list');
    const pend = {}; // 勾选先放暂存，点提交才真正入库
    const updPend = () => {
      const n = Object.keys(pend).length;
      const el = c.querySelector('#pendCnt');
      if (el) el.textContent = n ? `本次已勾选 ${n} 条，待提交` : '';
    };
    const draw = (kw) => {
      const list = kw ? rules.filter((r) => (r.risk || '').includes(kw) || (r.q || '').includes(kw)) : rules;
      listEl.innerHTML = list
        .slice(0, 200)
        .map((r) => {
          const a = pend[r.id] || answered[r.id]; // 暂存优先显示
          return `<div class="q" data-rule="${r.id}">
            <div class="q-text">${UI.esc(r.q || r.risk)}<br/><small style="color:var(--muted)">${UI.esc(r.id)} · ${UI.esc(r.catLabel || r.cat)}</small></div>
            <div class="opts">
              <button class="opt ${a && a.answer === 'yes' ? 'on-yes' : ''}" data-ans="yes">已做到</button>
              <button class="opt ${a && a.answer === 'no' ? 'on-no' : ''}" data-ans="no">没做到</button>
              <button class="opt ${a && a.answer === 'unsure' ? 'on-unsure' : ''}" data-ans="unsure">待核实</button>
              <button class="opt ${a && a.answer === 'na' ? 'on-na' : ''}" data-ans="na">不适用</button>
              <button class="opt" data-law="${r.id}" title="查看本题法律依据">法律依据</button>
            </div>
          </div>`;
        })
        .join('');

      listEl.querySelectorAll('.opt[data-ans]').forEach((b) => {
        b.onclick = () => {
          const wrap = b.closest('.q');
          const rid = wrap.dataset.rule;
          const ans = b.dataset.ans;
          wrap.querySelectorAll('.opt[data-ans]').forEach((o) => o.classList.remove('on-yes', 'on-no', 'on-unsure', 'on-na'));
          b.classList.add('on-' + ans);
          pend[rid] = { ruleId: rid, answer: ans };
          updPend();
        };
      });
      listEl.querySelectorAll('[data-law]').forEach((b) => {
        b.onclick = () => {
          const r = rules.find((x) => x.id === b.dataset.law);
          if (!r) return;
          const laws = Array.isArray(r.law) ? r.law : [];
          const body = laws.length
            ? laws.map((l) => `<p style="margin:0 0 8px"><b>${UI.esc(l.ref || '')}</b><br/><span style="font-size:13px">${UI.esc(l.text || '')}</span></p>`).join('')
            : '<p style="margin:0;color:var(--muted)">该题暂未收录法条原文。</p>';
          UI.modal('法律依据', `<p style="margin:0 0 10px;color:var(--muted);font-size:13px">${UI.esc(r.q || r.risk)}</p>` + body,
            [{ text: '关闭', cls: '', onClick: () => UI.closeModal() }]);
        };
      });
    };
    draw('');

    c.querySelector('#btnSubmit').onclick = async () => {
      const ids = Object.keys(pend);
      if (!ids.length) return UI.toast('还没有勾选任何项目');
      for (const rid of ids) {
        await API.confirm(rid, pend[rid].answer, '');
        answered[rid] = { ruleId: rid, answer: pend[rid].answer };
        delete pend[rid];
      }
      const enterCnt = ids.filter((rid) => answered[rid].answer === 'no' || answered[rid].answer === 'unsure').length;
      UI.toast(enterCnt ? `已提交，${enterCnt} 条「没做到/待核实」已进入风险清单` : '已提交，本次没有新增风险');
      location.hash = '#/risk';
    };
    c.querySelector('#kw').oninput = (e) => draw(e.target.value.trim());
  },
};

/* ============ 自检问卷 ============ */
PAGES.survey = {
  title: '用工自检问卷',
  async render(c) {
    const d = await API.quiz();
    const cats = d.categories || [];
    const answers = {};
    const total = cats.reduce((s, x) => s + x.questions.length, 0);

    c.innerHTML = `
      <div class="card">
        <div class="toolbar"><h2 style="margin:0">用工自检问卷</h2><div class="spacer"></div><span id="prog">已答 0 / ${total}</span></div>
        <div class="progress-bar"><div class="progress-fill" id="fill"></div></div>
        <p style="color:var(--muted);font-size:13px;margin:10px 0 0">系统算不出的项目，用问卷补。答「没做到」的会进入风险清单。</p>
      </div>
      <div id="quizBox"></div>
      <div class="toolbar"><button class="btn primary" id="btnSubmit">提交问卷并刷新风险清单</button></div>`;

    const box = c.querySelector('#quizBox');
    box.innerHTML = cats
      .map(
        (cat) => `<div class="card">
        <h3>${UI.esc(cat.label)} <span class="tag gray">${UI.esc(cat.flow || '')}</span></h3>
        <p style="color:var(--muted);font-size:12.5px;margin:0 0 8px">${UI.esc(cat.desc || '')}</p>
        ${cat.questions
          .map(
            (q) => `<div class="q" data-id="${UI.esc(q.id)}">
              <div class="q-text">${UI.esc(q.q)}</div>
              <div class="opts">
                <button class="opt" data-ans="yes">已做到</button>
                <button class="opt" data-ans="no">没做到</button>
                <button class="opt" data-ans="unsure">不确定</button>
              </div>
            </div>`
          )
          .join('')}
      </div>`
      )
      .join('');

    const upd = () => {
      const n = Object.keys(answers).length;
      c.querySelector('#prog').textContent = `已答 ${n} / ${total}`;
      c.querySelector('#fill').style.width = total ? (n / total) * 100 + '%' : '0%';
    };

    box.querySelectorAll('.opt').forEach((b) => {
      b.onclick = () => {
        const wrap = b.closest('.q');
        answers[wrap.dataset.id] = b.dataset.ans;
        wrap.querySelectorAll('.opt').forEach((o) => o.classList.remove('on-yes', 'on-no', 'on-unsure'));
        b.classList.add('on-' + b.dataset.ans);
        upd();
      };
    });

    c.querySelector('#btnSubmit').onclick = async () => {
      if (!Object.keys(answers).length) return UI.toast('至少回答一题');
      await API.survey(answers);
      UI.toast('已提交，风险清单已更新');
      location.hash = '#/risk';
    };
  },
};

/* ============ AI 劳动法问答 ============ */
PAGES.ai = {
  title: 'AI 劳动法问答',
  history: [],
  async render(c) {
    c.innerHTML = `
      <div class="notice">回答由 AI 基于劳动法知识库检索生成，仅供初步参考，不构成正式法律意见。</div>
      <div class="chat-wrap">
        <div class="chat-msgs" id="msgs">
          <div class="msg bot"><div class="bubble">你好，我是小哲的劳动法助手。可以直接问我，例如：
· 员工入职后多久必须签书面劳动合同？
· 试用期最长能约定多久？
· 未依法缴纳社保会有什么后果？</div></div>
        </div>
        <div class="composer">
          <input id="inp" placeholder="输入劳动法问题，回车发送" />
          <button class="btn primary" id="send">发送</button>
        </div>
      </div>`;
    const msgs = c.querySelector('#msgs');
    const inp = c.querySelector('#inp');

    const send = async (text) => {
      const q = String(text || '').trim();
      if (!q) return;
      msgs.innerHTML += `<div class="msg user"><div class="bubble">${UI.esc(q)}</div></div>`;
      inp.value = '';
      const id = 'm' + Date.now();
      msgs.innerHTML += `<div class="msg bot" id="${id}"><div class="bubble">正在检索法条并生成回答…</div></div>`;
      msgs.scrollTop = msgs.scrollHeight;
      try {
        const r = await API.chat(q, PAGES.ai.history);
        const cites = (r.citations || []).map((x) => '· ' + x.ref).join('\n');
        document.getElementById(id).querySelector('.bubble').textContent =
          r.answer + (cites ? '\n\n参考依据：\n' + cites : '') + '\n\n（' + r.model + '）';
        PAGES.ai.history.push({ role: 'user', content: q }, { role: 'assistant', content: r.answer });
      } catch (e) {
        document.getElementById(id).querySelector('.bubble').textContent = '请求失败：' + e.message;
      }
      msgs.scrollTop = msgs.scrollHeight;
    };

    c.querySelector('#send').onclick = () => send(inp.value);
    inp.onkeydown = (e) => e.key === 'Enter' && send(inp.value);
  },
};
