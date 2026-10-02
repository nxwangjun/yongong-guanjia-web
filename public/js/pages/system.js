/* 系统模块：成员账户（含邀请）/ 数据导入导出 / 系统设置（两角色：管理员 + 普通用户） */
window.PAGES = window.PAGES || {};

/* ============ 成员账户 ============ */
PAGES.member = {
  title: '成员账户',
  async render(c) {
    const list = await API.list('accounts');
    const roleLabel = (r) => (r === 'admin' ? '管理员' : '普通用户');
    c.innerHTML = `
      <div class="card">
        <h2>成员账号</h2>
        <p style="color:var(--muted);font-size:13px;margin:0 0 12px">
          系统只有两个角色：<b>管理员</b>（注册时创建，全部权限）与<b>普通用户</b>（可录数据、看检测、用 AI，不能进本页和系统设置）。停用后该账号无法登录。
        </p>
        <table class="tbl">
          <thead><tr><th>姓名</th><th>登录账号</th><th style="width:90px">角色</th><th style="width:110px">部门</th><th style="width:90px">状态</th><th style="width:90px">操作</th></tr></thead>
          <tbody>
            ${list.length
              ? list
                  .map(
                    (a) => `<tr>
                  <td>${UI.esc(a.name || '')}</td>
                  <td>${UI.esc(a.username || '')}</td>
                  <td><span class="tag ${a.role === 'admin' ? 'blue' : 'gray'}">${roleLabel(a.role)}</span></td>
                  <td>${UI.esc(a.dept || '—')}</td>
                  <td>${a.enabled === false ? '<span class="tag orange">已停用</span>' : '<span class="tag green">在用</span>'}</td>
                  <td>${a.role === 'admin' ? '' : `<button class="btn small ${a.enabled === false ? '' : 'danger'}" data-tg="${a._id}" data-en="${a.enabled === false ? '1' : '0'}">${a.enabled === false ? '启用' : '停用'}</button>`}</td>
                </tr>`
                  )
                  .join('')
              : '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:20px">暂无成员</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="toolbar"><h2 style="margin:0">邀请普通用户</h2><div class="spacer"></div>
          <input class="search" id="invDept" placeholder="所属部门（可空）" style="width:150px" />
          <button class="btn primary" id="gen">生成邀请码</button></div>
        <p style="color:var(--muted);font-size:13px;margin:0 0 10px">
          把邀请码发给同事，他在登录页选「邀请码加入」，注册后即成为本公司普通用户。
        </p>
        <div id="inviteBox"></div>
        <div id="inviteList" style="margin-top:10px"></div>
      </div>`;

    const renderInvites = async () => {
      const inv = await API.list('invites');
      c.querySelector('#inviteList').innerHTML = inv.length
        ? `<table class="tbl">
            <thead><tr><th>邀请码</th><th style="width:110px">创建时间</th><th style="width:90px">状态</th><th style="width:90px">操作</th></tr></thead>
            <tbody>${inv
              .map(
                (i) => `<tr>
                <td><b style="letter-spacing:1px">${UI.esc(i.code)}</b></td>
                <td>${UI.fmtDate(i.createdAt)}</td>
                <td>${i.used ? '<span class="tag gray">已使用</span>' : '<span class="tag green">有效</span>'}</td>
                <td>${i.used ? '' : `<button class="btn small danger" data-del="${i._id}">吊销</button>`}</td>
              </tr>`
              )
              .join('')}</tbody>
          </table>`
        : '';
      c.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
        await API.remove('invites', b.dataset.del);
        UI.toast('已吊销');
        renderInvites();
      }));
    };
    renderInvites();

    c.querySelectorAll('[data-tg]').forEach((b) => (b.onclick = async () => {
      await API.update('accounts', b.dataset.tg, { enabled: b.dataset.en === '1' });
      UI.toast(b.dataset.en === '1' ? '已启用' : '已停用');
      PAGES.member.render(c);
    }));

    c.querySelector('#gen').onclick = async () => {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      await API.add('invites', {
        code,
        role: 'user',
        dept: c.querySelector('#invDept').value.trim(),
        used: false,
        createdAt: Date.now(),
      });
      c.querySelector('#inviteBox').innerHTML = `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;font-size:14px;margin-bottom:10px">
          邀请码：<b style="font-size:18px;letter-spacing:2px">${code}</b><br/>
          <span style="color:var(--muted);font-size:13px">让成员在登录页选「邀请码加入」，填此码注册即可。</span>
        </div>`;
      UI.toast('已生成：' + code);
      renderInvites();
    };
  },
};

/* ============ 数据导入导出 ============ */
PAGES.dataio = {
  title: '数据导入导出',
  async render(c) {
    const COLS = [
      ['employees', '员工'], ['contracts', '劳动合同'], ['attendances', '考勤'],
      ['payrolls', '薪资'], ['socials', '社保'], ['certs', '证照'], ['riskItems', '风险处置'],
    ];
    c.innerHTML = `
      <div class="card">
        <h2>导出（Excel / WPS 可直接打开）</h2>
        <p style="color:var(--muted);font-size:13px">
          导出 7 张表（员工、劳动合同、考勤、薪资、社保、证照、风险处置），表头为中文，改完可直接导回。
        </p>
        <div class="toolbar">
          <button class="btn primary" id="expXlsx">导出 Excel（.xlsx）</button>
          <button class="btn" id="expJson">导出 JSON 备份</button>
        </div>
        <div class="toolbar" style="margin-top:10px">
          <span style="font-size:13px;color:var(--muted)">单表导出 CSV：</span>
          <select id="csvCol" style="border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px">
            ${COLS.map((x) => `<option value="${x[0]}">${x[1]}</option>`).join('')}
          </select>
          <button class="btn" id="expCsv">导出 CSV</button>
        </div>
      </div>

      <div class="card">
        <h2>导入</h2>
        <p style="color:var(--muted);font-size:13px">
          <b>.xlsx</b>：按工作表名自动对应（员工 / 劳动合同 / 考勤 / 薪资 / 社保 / 证照 / 风险处置），表头需与导出时一致。<br/>
          <b>.csv</b>：单表导入，需在下边选择对应表；CSV 也是 Excel / WPS 能直接打开编辑的格式。
        </p>
        <input type="file" id="file" accept=".xlsx,.csv,.json" />
        <div class="toolbar" style="margin-top:10px">
          <span style="font-size:13px;color:var(--muted)">CSV 导入到：</span>
          <select id="impCol" style="border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px">
            ${COLS.map((x) => `<option value="${x[0]}">${x[1]}</option>`).join('')}
          </select>
          <button class="btn primary" id="impBtn">确认导入</button>
        </div>
        <p style="color:var(--muted);font-size:12.5px;margin:8px 0 0">
          导入为<b>追加</b>模式：新记录直接加入，不影响已有数据。
        </p>
      </div>

      <div class="card">
        <h2>恢复演示数据</h2>
        <p style="color:var(--muted);font-size:13px">清空当前公司数据，恢复为内置的 12 人演示数据（含 9 类预埋风险）。</p>
        <button class="btn danger" id="rst">恢复演示数据</button>
      </div>`;

    // 导出
    c.querySelector('#expXlsx').onclick = () => {
      window.location.href = '/api/export.xlsx?token=' + encodeURIComponent(API.getToken());
      UI.toast('已开始下载 Excel');
    };
    c.querySelector('#expCsv').onclick = () => {
      const col = c.querySelector('#csvCol').value;
      window.location.href = '/api/export.csv?col=' + col + '&token=' + encodeURIComponent(API.getToken());
    };
    c.querySelector('#expJson').onclick = async () => {
      const data = await API.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '小哲用工风险检测_备份_' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      UI.toast('已导出 JSON');
    };

    // 导入
    let picked = null;
    c.querySelector('#file').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      picked = f;
      UI.toast('已选择：' + f.name);
    };

    c.querySelector('#impBtn').onclick = async () => {
      if (!picked) return UI.toast('请先选择文件');
      const name = picked.name.toLowerCase();
      try {
        if (name.endsWith('.xlsx')) {
          const buf = await picked.arrayBuffer();
          const r = await fetch(
            '/api/import/file?type=xlsx&token=' + encodeURIComponent(API.getToken()),
            { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf }
          ).then((x) => x.json());
          if (r.error) return UI.toast(r.error);
          UI.toast('已导入 ' + r.imported + ' 条：' + (r.detail || []).join('，'));
        } else if (name.endsWith('.csv')) {
          const text = await picked.text();
          const col = c.querySelector('#impCol').value;
          const r = await fetch(
            '/api/import/file?type=csv&col=' + col + '&token=' + encodeURIComponent(API.getToken()),
            { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text }
          ).then((x) => x.json());
          if (r.error) return UI.toast(r.error);
          UI.toast('已导入 ' + r.imported + ' 条');
        } else if (name.endsWith('.json')) {
          const obj = JSON.parse(await picked.text());
          const r = await API.importAll(obj);
          UI.toast('已导入 ' + r.imported + ' 条');
        } else {
          return UI.toast('只支持 .xlsx / .csv / .json');
        }
        setTimeout(() => location.reload(), 800);
      } catch (e) {
        UI.toast('导入失败：' + e.message);
      }
    };

    c.querySelector('#rst').onclick = () =>
      UI.confirmBox('将清空当前公司全部数据，恢复演示数据，确定？', async () => {
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
    const [s, h, rg] = await Promise.all([
      API.settings(), API.health(),
      API.get('/api/regions').catch(() => ({ regions: [] })),
    ]);
    const regions = rg.regions || [];
    const cur = s.region || '';

    // 已存地区在列表里没有（比如手填过的"宁夏银川"），补一个自定义项
    const inList = regions.some((r) => r.name === cur || cur.indexOf(r.name) === 0);

    c.innerHTML = `
      <div class="card">
        <h2>企业信息</h2>
        <div class="form-grid">
          <label>企业名称<input id="companyName" value="${UI.esc(s.companyName || '')}" /></label>
          <label>所在地区
            <select id="region">
              <option value="">（未选择）</option>
              ${regions
                .map(
                  (r) =>
                    `<option value="${UI.esc(r.name)}" ${
                      cur && (cur === r.name || cur.indexOf(r.name) === 0) ? 'selected' : ''
                    }>${UI.esc(r.name)}</option>`
                )
                .join('')}
              ${!inList && cur ? `<option value="${UI.esc(cur)}" selected>${UI.esc(cur)}（自定义）</option>` : ''}
            </select>
          </label>
        </div>
        <div id="regionInfo" style="margin-top:12px"></div>
      </div>

      <div class="card">
        <h2>风险判定阈值</h2>
        <p style="color:var(--muted);font-size:13px;margin:0 0 10px">
          选好地区后，下方会自动带出当地的用工标准（最低工资等），带出的数字可以手工改。
        </p>
        <div class="form-grid">
          <label>当地最低工资（元/月）<input id="minWage" type="number" value="${UI.esc(s.minWage ?? 0)}" /></label>
          <label>最低工资档位
            <select id="tierSel"><option value="">（手动填写时不选）</option></select>
          </label>
          <label>签约期限（天，超过即算未签合同）<input id="signDeadlineDays" type="number" value="${UI.esc(s.signDeadlineDays ?? 30)}" /></label>
          <label>合同到期提醒（天）<input id="contractExpireDays" type="number" value="${UI.esc(s.contractExpireDays ?? 30)}" /></label>
          <label>月加班上限（小时）<input id="overtimeLimitMonth" type="number" value="${UI.esc(s.overtimeLimitMonth ?? 36)}" /></label>
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

    // ---- 地区 → 自动带出当地用工标准 ----
    const regionSel = c.querySelector('#region');
    const infoBox = c.querySelector('#regionInfo');
    const tierSel = c.querySelector('#tierSel');
    const minWageInput = c.querySelector('#minWage');
    const CN = ['一', '二', '三', '四', '五'];
    // 当前选中的地区若带档位，默认把档位下拉选到与已存 minWage 相同的那个
    let curRegion = regionSel.value;

    function applyRegion(name, autoFill) {
      const r = regions.filter((x) => x.name === name)[0];
      if (!r) {
        infoBox.innerHTML = '';
        tierSel.innerHTML = '<option value="">（手动填写时不选）</option>';
        return;
      }
      tierSel.innerHTML =
        '<option value="">（手动填写时不选）</option>' +
        r.tiers
          .map((v, i) => `<option value="${v}">第${CN[i] || i + 1}档 · ${v} 元</option>`)
          .join('');
      if (autoFill) minWageInput.value = r.first;
      else {
        const hit = r.tiers.filter((v) => String(v) === String(minWageInput.value))[0];
        if (hit) tierSel.value = String(hit);
      }
      infoBox.innerHTML = `
        <div style="background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px">
          <b>${UI.esc(r.name)}</b> 现行月最低工资：
          ${r.tiers.map((v, i) => `<span class="tag blue">${CN[i] || i + 1}档 ${v} 元</span>`).join(' ')}
          ${r.note ? `<div style="color:var(--muted);margin-top:4px">${UI.esc(r.note)}</div>` : ''}
          ${r.pending
            ? `<div style="color:#b45309;margin-top:4px">⚠ ${UI.esc(r.pending.from)} 起执行新标准 ${r.pending.tiers.join(' / ')} 元，到生效日自动切换，不会提前误判</div>`
            : ''}
          ${r.source
            ? `<div style="color:var(--muted);margin-top:4px;font-size:12px">来源：${UI.esc(r.source)}　数据口径 ${UI.esc(rg.updated || '')}</div>`
            : ''}
        </div>`;
    }

    regionSel.onchange = () => applyRegion(regionSel.value, true);
    tierSel.onchange = () => {
      if (tierSel.value) minWageInput.value = tierSel.value;
    };
    applyRegion(curRegion, false);

    const num = (id) => Number(c.querySelector('#' + id).value) || 0;
    c.querySelector('#save').onclick = async () => {
      await API.saveSettings({
        companyName: c.querySelector('#companyName').value,
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
