/* 系统模块：角色权限 / 成员账户 / 邀请成员 / 模块编排 / 审计日志 / 数据导入导出 / 系统设置 */
window.PAGES = window.PAGES || {};

const ALL_MODULES = [
  ['home', '首页'], ['staff', '员工档案'], ['contract', '合同管理'], ['attend', '考勤工时'],
  ['payroll', '薪资'], ['social', '社保'], ['cert', '证照资质'],
  ['risk', '风险清单'], ['riskrule', '规则配置'], ['riskconfirm', '确认台账'],
  ['risktodo', '风险处置'], ['survey', '自检问卷'], ['ai', 'AI 问答'],
  ['apply', '申请中心'], ['approve', '审批中心'], ['flowdesign', '流程编排'],
  ['role', '角色权限'], ['member', '成员账户'], ['invite', '邀请成员'],
  ['layout', '模块编排'], ['audit', '审计日志'], ['dataio', '数据导入导出'], ['setting', '系统设置'],
];

const ROLES = [['admin', '管理员'], ['hr', '人力资源'], ['legal', '法务'], ['approver', '审批人'], ['staff', '普通员工']];

/* ============ 角色权限 ============ */
PAGES.role = {
  title: '角色权限',
  async render(c) {
    const s = await API.settings();
    const map = s.roleModules || {};
    c.innerHTML = `
      <div class="card">
        <h2>角色与模块挂载</h2>
        <p style="color:var(--muted);font-size:13px;margin:0 0 12px">
          勾选后该角色可见可用。管理员天然拥有全部权限，无需勾选。
        </p>
        <table class="tbl">
          <thead><tr><th>模块</th>${ROLES.map((r) => `<th style="width:88px">${r[1]}</th>`).join('')}</tr></thead>
          <tbody>
            ${ALL_MODULES.map(
              (m) => `<tr>
              <td>${m[1]} <small style="color:var(--muted)">${m[0]}</small></td>
              ${ROLES.map(
                (r) => `<td><input type="checkbox" data-m="${m[0]}" data-r="${r[0]}" ${
                  (map[r[0]] || []).includes(m[0]) ? 'checked' : ''
                } ${r[0] === 'admin' ? 'disabled checked' : ''} /></td>`
              ).join('')}
            </tr>`
            ).join('')}
          </tbody>
        </table>
        <div class="toolbar" style="margin-top:12px">
          <button class="btn primary" id="save">保存权限配置</button>
          <span class="tag gray">权限按「角色 → 模块」两级控制</span>
        </div>
      </div>`;

    c.querySelector('#save').onclick = async () => {
      const next = {};
      ROLES.forEach((r) => (next[r[0]] = []));
      c.querySelectorAll('[data-m]').forEach((cb) => {
        if (cb.checked) next[cb.dataset.r].push(cb.dataset.m);
      });
      next.admin = ALL_MODULES.map((m) => m[0]);
      await API.saveSettings({ roleModules: next });
      UI.toast('权限已保存');
    };
  },
};

/* ============ 成员账户 ============ */
PAGES.member = {
  title: '成员账户',
  render(c) {
    return UI.crudPage(c, {
      title: '成员账号',
      col: 'accounts',
      desc: '公司成员的真实登录账号。改角色即改权限；停用后该账号无法登录。',
      fields: [
        { k: 'username', t: '登录账号', type: 'text', required: true },
        { k: 'name', t: '姓名', type: 'text', required: true },
        { k: 'role', t: '角色', type: 'select', options: ROLES },
        { k: 'dept', t: '所属部门', type: 'text' },
        { k: 'employeeId', t: '关联员工档案ID', type: 'text' },
        { k: 'enabled', t: '启用', type: 'select', options: [['1', '是'], ['0', '否']] },
      ],
    });
  },
};

/* ============ 邀请成员 ============ */
PAGES.invite = {
  title: '邀请成员',
  async render(c) {
    const list = await API.list('invites');
    c.innerHTML = `
      <div class="card">
        <div class="toolbar"><h2 style="margin:0">邀请成员</h2><div class="spacer"></div>
          <select id="invRole" style="border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px">
            ${ROLES.filter((r) => r[0] !== 'admin').map((r) => `<option value="${r[0]}">${r[1]}</option>`).join('')}
          </select>
          <input class="search" id="invDept" placeholder="所属部门（可空）" style="width:150px" />
          <button class="btn primary" id="gen">生成邀请码</button></div>
        <p style="color:var(--muted);font-size:13px;margin:0 0 10px">
          生成的码发给成员，他在登录页选「邀请码加入」，填码注册后自动进入本公司并拿到对应角色。
        </p>
        <table class="tbl">
          <thead><tr><th>邀请码</th><th style="width:110px">创建时间</th><th style="width:90px">状态</th><th style="width:90px">操作</th></tr></thead>
          <tbody>
            ${list.length
              ? list
                  .map(
                    (i) => `<tr>
                  <td>${UI.esc(i.code)} <span class="tag blue">${UI.esc((ROLES.filter((r) => r[0] === i.role)[0] || ['', i.role || 'staff'])[1])}</span></td>
                  <td>${UI.fmtDate(i.createdAt)}</td>
                  <td>${i.used ? '<span class="tag gray">已使用</span>' : '<span class="tag green">有效</span>'}</td>
                  <td><button class="btn small danger" data-del="${i._id}">吊销</button></td>
                </tr>`
                  )
                  .join('')
              : '<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:20px">暂无邀请码</td></tr>'}
          </tbody>
        </table>
      </div>`;
    c.querySelector('#gen').onclick = async () => {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      await API.add('invites', {
        code,
        role: c.querySelector('#invRole').value,
        dept: c.querySelector('#invDept').value.trim(),
        used: false,
      });
      UI.toast('已生成：' + code + '（把它发给成员）');
      PAGES.invite.render(c);
    };
    c.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      await API.remove('invites', b.dataset.del);
      UI.toast('已吊销');
      PAGES.invite.render(c);
    }));
  },
};

/* ============ 模块编排 ============ */
PAGES.layout = {
  title: '模块编排',
  async render(c) {
    const s = await API.settings();
    const hidden = s.hiddenModules || [];
    const order = s.moduleOrder || [];
    const mods = ALL_MODULES.slice().sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    c.innerHTML = `
      <div class="card">
        <div class="toolbar"><h2 style="margin:0">模块编排</h2><div class="spacer"></div>
          <button class="btn primary" id="save">保存编排</button></div>
        <p style="color:var(--muted);font-size:13px;margin:0 0 10px">控制侧边栏模块的显隐与排序。</p>
        <table class="tbl">
          <thead><tr><th style="width:60px">显示</th><th>模块</th><th style="width:150px">排序</th></tr></thead>
          <tbody>
            ${mods
              .map(
                (m, i) => `<tr data-key="${m[0]}">
              <td><input type="checkbox" data-vis="${m[0]}" ${hidden.includes(m[0]) ? '' : 'checked'} /></td>
              <td>${m[1]}</td>
              <td><button class="btn small" data-up="${m[0]}">↑</button> <button class="btn small" data-down="${m[0]}">↓</button></td>
            </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>`;

    const move = (key, dir) => {
      const keys = [...c.querySelectorAll('[data-key]')].map((tr) => tr.dataset.key);
      const i = keys.indexOf(key);
      const j = i + dir;
      if (j < 0 || j >= keys.length) return;
      [keys[i], keys[j]] = [keys[j], keys[i]];
      // 重排 DOM
      const tb = c.querySelector('tbody');
      keys.forEach((k) => tb.appendChild(tb.querySelector(`[data-key="${k}"]`)));
    };
    c.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => move(b.dataset.up, -1)));
    c.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => move(b.dataset.down, 1)));
    c.querySelector('#save').onclick = async () => {
      const hid = [];
      c.querySelectorAll('[data-vis]').forEach((cb) => {
        if (!cb.checked) hid.push(cb.dataset.vis);
      });
      const ord = [...c.querySelectorAll('[data-key]')].map((tr) => tr.dataset.key);
      await API.saveSettings({ hiddenModules: hid, moduleOrder: ord });
      UI.toast('已保存，刷新后生效');
      setTimeout(() => location.reload(), 600);
    };
  },
};

/* ============ 审计日志（只读） ============ */
PAGES.audit = {
  title: '审计日志',
  async render(c) {
    const list = await API.list('audit');
    c.innerHTML = `
      <div class="card">
        <div class="toolbar"><h2 style="margin:0">审计日志（只读）</h2><div class="spacer"></div>
          <span class="tag gray">${list.length} 条</span></div>
        <table class="tbl">
          <thead><tr><th style="width:160px">时间</th><th style="width:120px">操作人</th><th style="width:120px">动作</th><th>详情</th></tr></thead>
          <tbody>
            ${list.length
              ? list
                  .map(
                    (a) => `<tr>
                  <td>${UI.fmtDate(a.at)} ${new Date(a.at).toTimeString().slice(0, 8)}</td>
                  <td>${UI.esc(a.who || '系统')}</td>
                  <td>${UI.esc(a.action)}</td>
                  <td>${UI.esc(a.detail || '')}</td>
                </tr>`
                  )
                  .join('')
              : '<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:20px">暂无日志</td></tr>'}
          </tbody>
        </table>
      </div>`;
  },
};

/* ============ 数据导入导出 ============ */
PAGES.dataio = {
  title: '数据导入导出',
  async render(c) {
    c.innerHTML = `
      <div class="card">
        <h2>导出</h2>
        <p style="color:var(--muted);font-size:13px">把全部业务数据导出为 JSON 备份文件。</p>
        <button class="btn primary" id="exp">导出全部数据</button>
      </div>
      <div class="card">
        <h2>导入</h2>
        <p style="color:var(--muted);font-size:13px">选择之前导出的 JSON 文件恢复数据（同名集合会被覆盖）。</p>
        <input type="file" id="file" accept="application/json" />
        <div class="toolbar" style="margin-top:10px"><button class="btn" id="imp">确认导入</button></div>
      </div>
      <div class="card">
        <h2>恢复演示数据</h2>
        <p style="color:var(--muted);font-size:13px">清空当前数据，恢复为内置的 12 人演示数据（含 9 类预埋风险）。</p>
        <button class="btn danger" id="rst">恢复演示数据</button>
      </div>`;

    c.querySelector('#exp').onclick = async () => {
      const data = await API.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '用工管家数据备份_' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      UI.toast('已导出');
    };

    let picked = null;
    c.querySelector('#file').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          picked = JSON.parse(rd.result);
          UI.toast('文件已读取，点击确认导入');
        } catch (x) {
          UI.toast('文件不是合法 JSON');
        }
      };
      rd.readAsText(f);
    };
    c.querySelector('#imp').onclick = async () => {
      if (!picked) return UI.toast('请先选择文件');
      const r = await API.importAll(picked);
      UI.toast('已导入 ' + r.imported + ' 条');
      setTimeout(() => location.reload(), 600);
    };
    c.querySelector('#rst').onclick = () =>
      UI.confirmBox('将清空当前全部数据，恢复演示数据，确定？', async () => {
        await API.reset();
        UI.toast('已恢复');
        setTimeout(() => location.reload(), 600);
      });
  },
};

/* ============ 系统设置 ============ */
PAGES.setting = {
  title: '系统设置',
  async render(c) {
    const [s, h] = await Promise.all([API.settings(), API.health()]);
    c.innerHTML = `
      <div class="card">
        <h2>企业信息</h2>
        <div class="form-grid">
          <label>企业名称<input id="companyName" value="${UI.esc(s.companyName || '')}" /></label>
          <label>企业规模<input id="companySize" value="${UI.esc(s.companySize || '')}" /></label>
          <label>所属行业<input id="industry" value="${UI.esc(s.industry || '')}" /></label>
          <label>所在地区<input id="region" value="${UI.esc(s.region || '')}" /></label>
        </div>
      </div>
      <div class="card">
        <h2>风险判定阈值</h2>
        <div class="form-grid">
          <label>签约期限（天，超过即算未签合同）<input id="signDeadlineDays" type="number" value="${UI.esc(s.signDeadlineDays ?? 30)}" /></label>
          <label>合同到期提醒（天）<input id="contractExpireDays" type="number" value="${UI.esc(s.contractExpireDays ?? 30)}" /></label>
          <label>月加班上限（小时）<input id="overtimeLimitMonth" type="number" value="${UI.esc(s.overtimeLimitMonth ?? 36)}" /></label>
          <label>当地最低工资（元/月）<input id="minWage" type="number" value="${UI.esc(s.minWage ?? 0)}" /></label>
          <label>证照到期提醒（天）<input id="certExpireDays" type="number" value="${UI.esc(s.certExpireDays ?? 30)}" /></label>
        </div>
        <div class="toolbar" style="margin-top:12px"><button class="btn primary" id="save">保存设置</button></div>
      </div>
      <div class="card">
        <h2>大模型（AI）配置</h2>
        <p style="color:var(--muted);font-size:13px;margin:0 0 10px">
          当前状态：<b>${h.llmEnabled ? '真实大模型已接入（' + UI.esc(h.model) + '）' : '未配置密钥 → 本地规则引擎兜底'}</b>
        </p>
        <div class="form-grid">
          <label>接口地址（OpenAI 兼容）<input id="baseUrl" placeholder="https://api.openai-next.com/v1" /></label>
          <label>模型名称<input id="model" placeholder="deepseek-v3" /></label>
          <label class="full">API Key（粘贴后立即生效）<input id="apiKey" type="password" placeholder="sk-…" /></label>
        </div>
        <div class="toolbar" style="margin-top:12px">
          <button class="btn primary" id="saveKey">保存并启用 AI</button>
          <button class="btn danger" id="clearKey">清空密钥</button>
        </div>
      </div>`;

    const num = (id) => Number(c.querySelector('#' + id).value) || 0;
    c.querySelector('#save').onclick = async () => {
      await API.saveSettings({
        companyName: c.querySelector('#companyName').value,
        companySize: c.querySelector('#companySize').value,
        industry: c.querySelector('#industry').value,
        region: c.querySelector('#region').value,
        signDeadlineDays: num('signDeadlineDays'),
        contractExpireDays: num('contractExpireDays'),
        overtimeLimitMonth: num('overtimeLimitMonth'),
        minWage: num('minWage'),
        certExpireDays: num('certExpireDays'),
      });
      UI.toast('已保存');
      APP.loadHealth();
    };
    c.querySelector('#saveKey').onclick = async () => {
      const r = await API.configKey({
        apiKey: c.querySelector('#apiKey').value.trim(),
        baseUrl: c.querySelector('#baseUrl').value.trim(),
        model: c.querySelector('#model').value.trim(),
      });
      UI.toast(r.llmEnabled ? 'AI 已启用' : '密钥为空，已切回本地规则引擎');
      APP.loadHealth();
    };
    c.querySelector('#clearKey').onclick = async () => {
      await API.configKey({ apiKey: '', baseUrl: '', model: '' });
      UI.toast('已清空密钥');
      APP.loadHealth();
    };
  },
};
