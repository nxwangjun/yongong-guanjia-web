/* 用工管家 AI Agent —— 前端交互（零构建，原生 JS） */

const state = {
  categories: [],
  answers: {},   // { questionId: 'yes'|'no'|'unsure' }
  total: 0,
  busy: false,
  chatHistory: [],
};

/* ---------- 工具 ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
function show(view) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- 状态灯 ---------- */
async function loadHealth() {
  try {
    const r = await fetch('/api/health');
    const d = await r.json();
    const badge = $('#statusBadge');
    if (d.llmEnabled) {
      badge.classList.add('ok');
      $('#statusText').textContent = `真实大模型已接入 · ${d.model}`;
    } else {
      badge.classList.add('off');
      $('#statusText').textContent = '本地规则引擎（未配置密钥）';
    }
    $('#footStatus').textContent =
      `用工管家 AI Agent · 知识库 ${d.corpusSize} 条 · 自检 ${d.quizCategories} 个环节 · AI软件赛道参赛作品`;
  } catch (e) {
    $('#statusText').textContent = '服务未连接';
  }
}

/* ---------- 问卷 ---------- */
async function loadQuiz() {
  const r = await fetch('/api/quiz');
  const d = await r.json();
  state.categories = d.categories || [];
  state.total = state.categories.reduce((s, c) => s + c.questions.length, 0);
  renderQuiz();
}

function renderQuiz() {
  const box = $('#quizList');
  box.innerHTML = state.categories
    .map(
      (c) => `
    <div class="card group">
      <div class="group-title">
        <h3>${esc(c.label)}</h3>
        <span class="flow">${esc(c.flow || '')}</span>
      </div>
      <p class="group-desc">${esc(c.desc || '')}</p>
      ${c.questions.map((q) => renderQuestion(q)).join('')}
    </div>`
    )
    .join('');
  updateProgress();
}

function renderQuestion(q) {
  return `
  <div class="q" data-id="${esc(q.id)}">
    <div class="q-text">${esc(q.q)}</div>
    <div class="opts">
      <button class="opt" data-ans="yes">已做到</button>
      <button class="opt" data-ans="no">没做到</button>
      <button class="opt" data-ans="unsure">不确定</button>
    </div>
  </div>`;
}

function updateProgress() {
  const n = Object.keys(state.answers).length;
  $('#progressText').textContent = `已答 ${n} / ${state.total} 题`;
  $('#progressFill').style.width = state.total ? (n / state.total) * 100 + '%' : '0%';
  $('#btnDiagnose').disabled = n === 0 || state.busy;
  $('#btnDiagnose').textContent = state.busy ? '正在生成…' : '生成 AI 诊断报告';
}

/* 事件委托：选项点击 */
document.addEventListener('click', (e) => {
  const opt = e.target.closest('.opt');
  if (!opt) return;
  const qEl = opt.closest('.q');
  const id = qEl.dataset.id;
  const ans = opt.dataset.ans;
  state.answers[id] = ans;
  qEl.querySelectorAll('.opt').forEach((o) => {
    o.classList.remove('on-yes', 'on-no', 'on-unsure');
  });
  opt.classList.add('on-' + ans);
  updateProgress();
});

/* ---------- 诊断 ---------- */
async function runDiagnose() {
  if (state.busy) return;
  state.busy = true;
  updateProgress();
  try {
    const r = await fetch('/api/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meta: {
          companySize: $('#metaSize').value.trim(),
          industry: $('#metaIndustry').value.trim(),
          region: $('#metaRegion').value.trim(),
        },
        answers: state.answers,
      }),
    });
    const d = await r.json();
    renderReport(d);
    show('report');
  } catch (e) {
    alert('诊断失败：' + e.message);
  } finally {
    state.busy = false;
    updateProgress();
  }
}

function renderReport(d) {
  const items = (d.items || []).slice().sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
  const firstCount = items.filter((i) => sevRank(i.severity) === 0).length;
  const counts = d.counts || {};

  const head = `
    <div class="report-summary">
      <h2>诊断结论</h2>
      <p>${esc(d.summary || '')}</p>
      <div class="counts">
        <span>需关注 <b>${items.length}</b> 项</span>
        ${firstCount ? `<span>建议优先处理 <b>${firstCount}</b> 项</span>` : ''}
        <span>已作答 <b>${Object.keys(state.answers).length}</b> 题</span>
      </div>
      <p style="font-size:12.5px;color:#4338ca;margin-top:8px;">
        生成方式：${esc(d.model || '')}
      </p>
    </div>`;

  const list = items.length
    ? items
        .map((it, idx) => {
          const first = sevRank(it.severity) === 0;
          const arts = (it.articles || [])
            .map((a) => `<div class="law-text">${esc(a)}</div>`)
            .join('');
          return `
        <div class="risk-item ${first ? 'first' : ''}">
          <div class="ri-head">
            <span class="ri-cat">${esc(it.category || '')}</span>
            <span class="ri-title">${idx + 1}. ${esc(it.risk || '')}</span>
            ${first ? '<span class="ri-cat" style="color:#b91c1c;">建议优先处理</span>' : ''}
          </div>
          ${it.law ? `<div class="row"><b>法律依据：</b>${esc(it.law)}</div>` : ''}
          ${it.consequence ? `<div class="row"><b>可能的后果：</b>${esc(it.consequence)}</div>` : ''}
          ${it.remedy ? `<div class="row"><b>整改建议：</b>${esc(it.remedy)}</div>` : ''}
          ${arts}
        </div>`;
        })
        .join('')
    : `<div class="card"><p>本次自检未发现明显违规风险点，建议保持现有合规动作并建立月度自查机制。</p></div>`;

  const advice = d.advice
    ? `<div class="card"><h3>整改行动建议</h3><div class="advice">${esc(d.advice)}</div></div>`
    : '';

  $('#reportBox').innerHTML =
    head + `<div class="card"><h3>风险清单（按处理优先级排序）</h3></div>` + list + advice +
    `<div class="notice" style="margin-top:14px;">${esc(d.disclaimer || '')}</div>`;
}

function sevRank(s) {
  if (s === '高') return 0;
  if (s === '中') return 1;
  return 2;
}

/* ---------- 问答 ---------- */
async function sendChat(text) {
  const q = String(text || '').trim();
  if (!q || state.busy) return;
  appendMsg('user', q);
  $('#chatInput').value = '';
  const loadingId = appendMsg('bot', '正在检索法条并生成回答…');
  state.busy = true;
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, history: state.chatHistory }),
    });
    const d = await r.json();
    const cites = (d.citations || [])
      .map((c) => `· ${c.ref}`)
      .join('\n');
    setMsg(loadingId, d.answer + (cites ? '\n\n参考依据：\n' + cites : ''));
    state.chatHistory.push({ role: 'user', content: q });
    state.chatHistory.push({ role: 'assistant', content: d.answer });
  } catch (e) {
    setMsg(loadingId, '请求失败：' + e.message);
  } finally {
    state.busy = false;
  }
}

function appendMsg(role, text) {
  const id = 'm' + Date.now() + Math.random().toString(36).slice(2, 6);
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  el.id = id;
  el.innerHTML = `<div class="bubble">${esc(text)}</div>`;
  $('#messages').appendChild(el);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  return id;
}
function setMsg(id, text) {
  const el = document.getElementById(id);
  if (el) el.querySelector('.bubble').textContent = text;
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

/* ---------- 绑定 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  $$('.tab').forEach((t) =>
    t.addEventListener('click', () => show(t.dataset.view))
  );

  $('#btnDiagnose').addEventListener('click', runDiagnose);
  $('#btnBackQuiz').addEventListener('click', () => show('quiz'));
  $('#btnPrint').addEventListener('click', () => window.print());
  $('#btnReset').addEventListener('click', () => {
    state.answers = {};
    $$('.opt').forEach((o) => o.classList.remove('on-yes', 'on-no', 'on-unsure'));
    updateProgress();
  });

  $('#btnSend').addEventListener('click', () => sendChat($('#chatInput').value));
  $('#chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat($('#chatInput').value);
  });
  $$('.chip').forEach((c) =>
    c.addEventListener('click', () => {
      show('chat');
      sendChat(c.textContent);
    })
  );

  loadHealth();
  loadQuiz();
});
