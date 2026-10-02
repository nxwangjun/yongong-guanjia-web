/* 流程模块：申请中心 / 审批中心 / 流程编排 */
window.PAGES = window.PAGES || {};

// 申请类型 → 由哪个主体（角色）审批
const APPLY_TYPES = [
  ['leave', '请假', 'approver'],
  ['ot', '加班', 'approver'],
  ['trip', '出差', 'approver'],
  ['expense', '报销', 'approver'],
  ['contract_review', '合同审查', 'legal'],
];
const APPLY_STATUS = [['pending', '待审批'], ['approved', '已同意'], ['rejected', '已驳回']];
const STATUS_TAG = { pending: 'orange', approved: 'green', rejected: 'red' };

function typeName(k) {
  const t = APPLY_TYPES.filter((x) => x[0] === k)[0];
  return t ? t[1] : k || '—';
}

/* ============ 申请中心 ============ */
PAGES.apply = {
  title: '申请中心',
  async render(c) {
    c.innerHTML = `
      <div class="card">
        <h2>发起申请</h2>
        <p style="color:var(--muted);font-size:13px;margin:0 0 10px">
          选好事项类型后，在「审批人」里挑具体的人。请假/加班/出差/报销找部门负责人，合同审查找法务。
        </p>
        <div class="form-grid">
          <label>事项类型
            <select id="aType">
              ${APPLY_TYPES.map((t) => `<option value="${t[0]}">${t[1]}（由${t[2] === 'legal' ? '法务' : '部门负责人'}审批）</option>`).join('')}
            </select>
          </label>
          <label>审批人
            <select id="aWho"><option value="">加载中…</option></select>
          </label>
          <label>天数 / 金额<input id="aDays" type="number" placeholder="如 3" /></label>
          <label>说明（合同审查请写合同名称与对方）<input id="aReason" placeholder="选填" /></label>
        </div>
        <div class="toolbar" style="margin-top:12px">
          <button class="btn primary" id="aSubmit">提交申请</button>
          <span id="aTip" style="font-size:13px;color:var(--muted)"></span>
        </div>
      </div>
      <div class="card">
        <h2>我发起的申请</h2>
        <div id="myList"></div>
      </div>`;

    const typeSel = c.querySelector('#aType');
    const whoSel = c.querySelector('#aWho');
    const tip = c.querySelector('#aTip');

    async function loadCandidates() {
      const t = typeSel.value;
      whoSel.innerHTML = '<option value="">加载中…</option>';
      try {
        const r = await API.get('/api/approver-candidates?type=' + t);
        if (!r.candidates.length) {
          whoSel.innerHTML = '<option value="">（暂无可选审批人，请联系管理员）</option>';
          tip.textContent = '';
          return;
        }
        whoSel.innerHTML = r.candidates
          .map(
            (p) =>
              `<option value="${p._id}">${UI.esc(p.name)}　${UI.esc(p.roleName)}${p.dept ? '（' + UI.esc(p.dept) + '）' : ''}</option>`
          )
          .join('');
        tip.textContent = `由「${r.roleName}」审批`;
      } catch (e) {
        whoSel.innerHTML = '<option value="">加载失败</option>';
      }
    }

    async function loadMine() {
      const list = await API.list('applies');
      const box = c.querySelector('#myList');
      if (!list.length) {
        box.innerHTML = '<p style="color:var(--muted)">还没有发起过申请</p>';
        return;
      }
      box.innerHTML = `<table class="tbl">
        <thead><tr><th>类型</th><th style="width:110px">审批人</th><th style="width:80px">天数/金额</th><th>说明</th><th style="width:90px">状态</th></tr></thead>
        <tbody>${list
          .map(
            (a) => `<tr>
            <td>${UI.esc(typeName(a.type))}</td>
            <td>${UI.esc(a.approverName || '—')}</td>
            <td>${UI.esc(a.days ?? '—')}</td>
            <td>${UI.esc(a.reason || '—')}</td>
            <td><span class="tag ${STATUS_TAG[a.status] || 'gray'}">${UI.esc((APPLY_STATUS.filter((s) => s[0] === a.status)[0] || ['', a.status || '待审批'])[1])}</span></td>
          </tr>`
          )
          .join('')}</tbody></table>`;
    }

    typeSel.onchange = loadCandidates;
    c.querySelector('#aSubmit').onclick = async () => {
      const who = whoSel.value;
      if (!who) return UI.toast('请选择审批人');
      const opt = whoSel.options[whoSel.selectedIndex];
      try {
        await API.add('applies', {
          type: typeSel.value,
          approverId: who,
          approverName: String(opt.textContent).split('　')[0].trim(),
          days: Number(c.querySelector('#aDays').value) || 0,
          reason: c.querySelector('#aReason').value.trim(),
        });
        UI.toast('已提交，等待审批');
        c.querySelector('#aDays').value = '';
        c.querySelector('#aReason').value = '';
        loadMine();
      } catch (e) {
        UI.toast('提交失败：' + e.message);
      }
    };

    await loadCandidates();
    await loadMine();
  },
};

/* ============ 审批中心 ============ */
PAGES.approve = {
  title: '审批中心',
  async render(c) {
    const [list, mine] = await Promise.all([
      API.list('applies'),
      API.me().catch(() => ({})),
    ]);
    const u = mine.user || {};
    const pending = list.filter((a) => a.status === 'pending' || !a.status).length;

    c.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <h2 style="margin:0">审批中心</h2>
          <div class="spacer"></div>
          <span class="tag ${pending ? 'orange' : 'green'}">待我审批 ${pending}</span>
          ${u.role === 'admin' || u.role === 'hr' || u.role === 'legal'
            ? '<span class="tag gray">管理角色：可看到全部申请</span>'
            : '<span class="tag gray">仅显示指派给我的</span>'}
        </div>
        <table class="tbl">
          <thead><tr><th style="width:90px">申请人</th><th style="width:80px">类型</th><th style="width:80px">天数/金额</th><th>说明</th><th style="width:90px">状态</th><th style="width:140px">操作</th></tr></thead>
          <tbody>
            ${list.length
              ? list
                  .map(
                    (a) => `<tr>
                  <td>${UI.esc(a.applicantName || a.employeeId || '—')}</td>
                  <td>${UI.esc(typeName(a.type))}</td>
                  <td>${UI.esc(a.days ?? '—')}</td>
                  <td>${UI.esc(a.reason || '—')}</td>
                  <td><span class="tag ${STATUS_TAG[a.status] || 'gray'}">${UI.esc((APPLY_STATUS.filter((s) => s[0] === a.status)[0] || ['', '待审批'])[1])}</span></td>
                  <td>${a.status === 'pending' || !a.status
                      ? `<button class="btn small" data-ok="${a._id}">同意</button> <button class="btn small danger" data-no="${a._id}">驳回</button>`
                      : `<button class="btn small" data-reset="${a._id}">退回待审</button>`}</td>
                </tr>`
                  )
                  .join('')
              : '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:20px">没有需要你审批的事项</td></tr>'}
          </tbody>
        </table>
      </div>`;

    const act = (id, status) => async () => {
      await API.update('applies', id, { status });
      UI.toast(status === 'approved' ? '已同意' : status === 'rejected' ? '已驳回' : '已退回');
      PAGES.approve.render(c);
    };
    c.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = act(b.dataset.ok, 'approved')));
    c.querySelectorAll('[data-no]').forEach((b) => (b.onclick = act(b.dataset.no, 'rejected')));
    c.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = act(b.dataset.reset, 'pending')));
  },
};

/* ============ 流程编排 ============ */
PAGES.flowdesign = {
  title: '流程编排',
  render(c) {
    return UI.crudPage(c, {
      title: '流程模板',
      col: 'flows',
      desc: '流程模板、节点与条件分支。示例节点写法：发起 → 部门主管 → 法务 → 归档。',
      fields: [
        { k: 'name', t: '流程名称', type: 'text', required: true },
        { k: 'nodes', t: '节点（用 → 分隔）', type: 'text' },
        { k: 'condition', t: '适用条件', type: 'text' },
        { k: 'version', t: '版本', type: 'text' },
        { k: 'enabled', t: '启用', type: 'select', options: [['1', '是'], ['0', '否']] },
      ],
    });
  },
};
