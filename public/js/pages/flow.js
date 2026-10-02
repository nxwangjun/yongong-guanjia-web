/* 流程模块：申请中心 / 审批中心 / 流程编排 */
window.PAGES = window.PAGES || {};

const APPLY_TYPES = [['leave', '请假'], ['ot', '加班'], ['trip', '出差'], ['expense', '报销']];
const APPLY_STATUS = [['pending', '待审批'], ['approved', '已同意'], ['rejected', '已驳回']];

/* ============ 申请中心 ============ */
PAGES.apply = {
  title: '申请中心',
  render(c) {
    return UI.crudPage(c, {
      title: '申请',
      col: 'applies',
      desc: '发起请假 / 加班 / 出差 / 报销，提交后进入审批中心。',
      fields: [
        { k: 'employeeId', t: '申请人', type: 'emp', required: true },
        { k: 'type', t: '类型', type: 'select', options: APPLY_TYPES },
        { k: 'days', t: '天数/金额', type: 'number' },
        { k: 'reason', t: '事由', type: 'textarea' },
        { k: 'status', t: '状态', type: 'select', options: APPLY_STATUS },
      ],
    });
  },
};

/* ============ 审批中心 ============ */
PAGES.approve = {
  title: '审批中心',
  async render(c) {
    const list = await API.list('applies');
    const pending = list.filter((a) => a.status === 'pending' || !a.status);
    let emps = [];
    try {
      emps = await API.list('employees');
    } catch (e) {}
    const nameOf = (id) => {
      const e = emps.filter((x) => x._id === id)[0];
      return e ? e.name : id || '—';
    };

    c.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <h2 style="margin:0">审批中心</h2>
          <div class="spacer"></div>
          <span class="tag ${pending.length ? 'orange' : 'green'}">待审批 ${pending.length}</span>
        </div>
        <table class="tbl">
          <thead><tr><th>申请人</th><th style="width:80px">类型</th><th style="width:90px">天数/金额</th><th>事由</th><th style="width:90px">状态</th><th style="width:140px">操作</th></tr></thead>
          <tbody>
            ${list.length
              ? list
                  .map(
                    (a) => `<tr>
                  <td>${UI.esc(nameOf(a.employeeId))}</td>
                  <td>${UI.esc((APPLY_TYPES.filter((t) => t[0] === a.type)[0] || ['', a.type || '—'])[1])}</td>
                  <td>${UI.esc(a.days ?? '—')}</td>
                  <td>${UI.esc(a.reason || '—')}</td>
                  <td>${a.status === 'approved' ? '<span class="tag green">已同意</span>' : a.status === 'rejected' ? '<span class="tag red">已驳回</span>' : '<span class="tag orange">待审批</span>'}</td>
                  <td>${a.status === 'pending' || !a.status
                      ? `<button class="btn small" data-ok="${a._id}">同意</button> <button class="btn small danger" data-no="${a._id}">驳回</button>`
                      : `<button class="btn small" data-reset="${a._id}">退回待审</button>`}</td>
                </tr>`
                  )
                  .join('')
              : '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:20px">暂无申请，可在「申请中心」发起</td></tr>'}
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
