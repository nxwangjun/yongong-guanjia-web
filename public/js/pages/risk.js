/* 法务风险模块：风险清单 / 规则配置 / 确认台账 / 风险处置 / AI 问答 / 自检问卷 */
window.PAGES = window.PAGES || {};

const DISCLAIMER =
  '⚠️ 本报告由自助诊断工具生成，仅供初步自查参考，不构成正式法律意见，也不替代律师当面咨询与阅卷。';

function sevRank(s) {
  return s === '高' ? 0 : s === '中' ? 1 : 2;
}

/* ============ 风险清单 ============ */
PAGES.risk = {
  title: '风险清单',
  async render(c) {
    c.innerHTML = `<div class="notice">${DISCLAIMER}</div><div class="card">正在扫描…</div>`;
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

    c.innerHTML = `
      <div class="notice">${DISCLAIMER}</div>
      <div class="stat-grid">
        <div class="stat"><b>${items.length}</b><span>需关注风险点</span></div>
        <div class="stat alert"><b>${firstCount}</b><span>建议优先处理</span></div>
        <div class="stat"><b>${people}</b><span>涉及人次</span></div>
        <div class="stat"><b>${items.filter((i) => i.source === '数据扫描').length}</b><span>由数据算出</span></div>
      </div>
      <div class="card">
        <div class="toolbar">
          <h2 style="margin:0">风险清单（按处理优先级排序）</h2>
          <div class="spacer"></div>
          <button class="btn" id="btnRescan">重新扫描</button>
        </div>
        <div id="riskList"></div>
        ${items.length ? '' : '<p style="color:var(--muted)">未发现风险。可先录入员工/合同/薪资数据，或在「确认台账」「自检问卷」里补充系统算不出的项目。</p>'}
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

    // 派发处置
    listEl.querySelectorAll('[data-dispatch]').forEach((b) => {
      b.onclick = async () => {
        const it = items[b.dataset.dispatch];
        try {
          const r = await API.dispatch({ ruleId: it.ruleId, risk: it.risk, owner: it.owner || 'hr' });
          if (r.duplicated) toast('已在处置台账中，去「风险处置」看进度');
          else toast('已派发到风险处置');
          b.textContent = '已派发';
          b.disabled = true;
        } catch (e) {
          toast('派发失败：' + e.message);
        }
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
      <button class="btn small" data-dispatch="${idx}">派发处置</button>
    </div>
    <div class="ri-body" id="body-${idx}">
      ${people ? `<b>涉及人员：</b><ul class="people-list">${people}</ul>` : ''}
      ${it.answer ? `<div style="margin-top:6px"><b>台账/问卷结论：</b>${it.answer === 'no' ? '未做到' : '待核实'}${it.note ? ' · 备注：' + UI.esc(it.note) : ''}</div>` : ''}
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
          ${rules.filter((r) => r.level === 'ask').length} 条需台账确认或问卷作答。
        </p>
        <table class="tbl">
          <thead><tr><th style="width:60px">启用</th><th>风险点</th><th style="width:90px">分类</th><th style="width:80px">方式</th><th style="width:70px">归口</th></tr></thead>
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
            <td>${UI.esc(r.owner || '')}</td>
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
  title: '法务确认台账',
  async render(c) {
    const [rd, dbConfirms] = await Promise.all([API.rules(), API.list('confirms')]);
    const rules = (rd.rules || []).filter((r) => r.level !== 'auto');
    const answered = {};
    dbConfirms.forEach((x) => (answered[x.ruleId] = x));

    c.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <h2 style="margin:0">法务确认台账（${rules.length} 条）</h2>
          <div class="spacer"></div>
          <input class="search" id="kw" placeholder="搜索…" />
        </div>
        <p style="color:var(--muted);font-size:13px;margin:0 0 10px">
          系统算不出的项目，由法务定期确认。答「没做到」的会进入风险清单。
        </p>
        <div id="list"></div>
      </div>`;
    const listEl = c.querySelector('#list');
    const draw = (kw) => {
      const list = kw ? rules.filter((r) => (r.risk || '').includes(kw) || (r.q || '').includes(kw)) : rules;
      listEl.innerHTML = list
        .slice(0, 200)
        .map((r) => {
          const a = answered[r.id];
          return `<div class="q" data-rule="${r.id}">
            <div class="q-text">${UI.esc(r.q || r.risk)}<br/><small style="color:var(--muted)">${UI.esc(r.id)} · ${UI.esc(r.catLabel || r.cat)}</small></div>
            <div class="opts">
              <button class="opt ${a && a.answer === 'yes' ? 'on-yes' : ''}" data-ans="yes">已做到</button>
              <button class="opt ${a && a.answer === 'no' ? 'on-no' : ''}" data-ans="no">没做到</button>
              <button class="opt ${a && a.answer === 'unsure' ? 'on-unsure' : ''}" data-ans="unsure">不适用/待核实</button>
            </div>
            ${a && a.answer === 'no' ? `<div style="margin-top:6px"><input class="search" style="width:100%" placeholder="备注（可选）" value="${UI.esc(a.note || '')}" data-note="${r.id}" /></div>` : ''}
          </div>`;
        })
        .join('');

      listEl.querySelectorAll('.opt').forEach((b) => {
        b.onclick = async () => {
          const wrap = b.closest('.q');
          const rid = wrap.dataset.rule;
          const ans = b.dataset.ans;
          wrap.querySelectorAll('.opt').forEach((o) => o.classList.remove('on-yes', 'on-no', 'on-unsure'));
          b.classList.add('on-' + ans);
          await API.confirm(rid, ans, '');
          answered[rid] = { ruleId: rid, answer: ans };
          UI.toast('已记录');
          if (ans === 'no') draw(c.querySelector('#kw').value.trim());
        };
      });
      listEl.querySelectorAll('[data-note]').forEach((inp) => {
        inp.onchange = async () => {
          await API.confirm(inp.dataset.note, 'no', inp.value);
          UI.toast('备注已保存');
        };
      });
    };
    draw('');
    c.querySelector('#kw').oninput = (e) => draw(e.target.value.trim());
  },
};

/* ============ 风险处置 ============ */
PAGES.risktodo = {
  title: '风险处置',
  async render(c) {
    const items = await API.list('riskItems');
    const open = items.filter((i) => i.todoStatus !== 'done').length;
    c.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <h2 style="margin:0">风险处置台账</h2>
          <div class="spacer"></div>
          <span class="tag ${open ? 'orange' : 'green'}">待处理 ${open} 条</span>
        </div>
        <table class="tbl">
          <thead><tr><th>风险点</th><th style="width:80px">归口</th><th style="width:90px">责任人</th><th style="width:110px">期限</th><th style="width:90px">状态</th><th style="width:130px">操作</th></tr></thead>
          <tbody>
            ${items.length
              ? items
                  .map(
                    (i) => `<tr>
                  <td>${UI.esc(i.risk)}<br/><small style="color:var(--muted)">${UI.esc(i.ruleId)}</small></td>
                  <td>${UI.esc(i.owner || '')}</td>
                  <td>${UI.esc(i.assignee || '—')}</td>
                  <td>${UI.fmtDate(i.dueDate)}</td>
                  <td>${i.todoStatus === 'done' ? '<span class="tag green">已关闭</span>' : i.todoStatus === 'doing' ? '<span class="tag blue">整改中</span>' : '<span class="tag orange">待处理</span>'}</td>
                  <td>
                    ${i.todoStatus === 'done' ? '' : `<button class="btn small" data-doing="${i._id}">开始整改</button> <button class="btn small" data-done="${i._id}">关闭</button>`}
                  </td>
                </tr>`
                  )
                  .join('')
              : '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:20px">暂无待处置风险，可在「风险清单」里派发</td></tr>'}
          </tbody>
        </table>
      </div>`;
    c.querySelectorAll('[data-doing]').forEach((b) => (b.onclick = async () => {
      await API.update('riskItems', b.dataset.doing, { todoStatus: 'doing' });
      UI.toast('已标记为整改中');
      PAGES.risktodo.render(c);
    }));
    c.querySelectorAll('[data-done]').forEach((b) => (b.onclick = async () => {
      await API.update('riskItems', b.dataset.done, { todoStatus: 'done' });
      UI.toast('已关闭');
      PAGES.risktodo.render(c);
    }));
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
      <div class="notice">${DISCLAIMER}</div>
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
          <div class="msg bot"><div class="bubble">你好，我是用工管家的劳动法助手。可以直接问我，例如：
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
