/* 系统模块：数据导入导出 / 系统设置（免登录 A1 版：数据全部在本浏览器 localStorage） */
window.PAGES = window.PAGES || {};

/* ============ 数据导入导出 ============ */
PAGES.dataio = {
  title: '数据导入导出',
  async render(c) {
    const COLS = [
      ['employees', '员工'], ['contracts', '劳动合同'], ['attendances', '考勤'],
      ['payrolls', '薪资'], ['socials', '社保'], ['certs', '证照'],
    ];
    c.innerHTML = `
      <div class="card">
        <h2>导出</h2>
        <p style="color:var(--muted);font-size:13px">
          所有数据只存在本浏览器里。建议定期导出 JSON 备份，换电脑或清浏览器数据前导一次。
        </p>
        <div class="toolbar">
          <button class="btn primary" id="expJson">导出 JSON 备份（全部数据）</button>
        </div>
        <div class="toolbar" style="margin-top:10px">
          <span style="font-size:13px;color:var(--muted)">单表导出 CSV（Excel / WPS 可直接打开）：</span>
          <select id="csvCol" style="border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px">
            ${COLS.map((x) => `<option value="${x[0]}">${x[1]}</option>`).join('')}
          </select>
          <button class="btn" id="expCsv">导出 CSV</button>
        </div>
      </div>

      <div class="card">
        <h2>导入</h2>
        <p style="color:var(--muted);font-size:13px">
          <b>.json</b>：整体恢复备份（覆盖当前全部数据，导入前会先让你确认）。<br/>
          <b>.csv</b>：单表导入，表头需与模板一致；先用「下载模板」拿一份空白表，Excel / WPS 填好后导回。
        </p>
        <input type="file" id="file" accept=".csv,.json" />
        <div class="toolbar" style="margin-top:10px">
          <span style="font-size:13px;color:var(--muted)">CSV 导入到：</span>
          <select id="impCol" style="border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px">
            ${COLS.map((x) => `<option value="${x[0]}">${x[1]}</option>`).join('')}
          </select>
          <button class="btn" id="tplBtn">下载模板</button>
          <button class="btn primary" id="impBtn">确认导入</button>
        </div>
        <p style="color:var(--muted);font-size:12.5px;margin:8px 0 0">
          CSV 导入为<b>追加</b>模式：新记录直接加入，不影响已有数据。导入前会先弹预览，确认无误才入库。
        </p>
      </div>

      <div class="card">
        <h2>恢复演示数据</h2>
        <p style="color:var(--muted);font-size:13px">清空当前数据，恢复为内置的 36 人演示数据（含 17 类预埋风险，外加证照临期提醒）。</p>
        <button class="btn danger" id="rst">恢复演示数据</button>
      </div>`;

    // ---- 导出 ----
    const download = (blob, name) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };

    c.querySelector('#expJson').onclick = async () => {
      const data = await API.exportAll();
      download(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        '小哲用工风险检测_备份_' + new Date().toISOString().slice(0, 10) + '.json'
      );
      UI.toast('已导出 JSON 备份');
    };

    c.querySelector('#expCsv').onclick = async () => {
      const col = c.querySelector('#csvCol').value;
      const items = await API.list(col);
      const text = window.CSV.colToCsv(col, items);
      const label = COLS.filter((x) => x[0] === col)[0][1];
      download(
        new Blob([text], { type: 'text/csv;charset=utf-8' }),
        '小哲用工风险检测_' + label + '_' + new Date().toISOString().slice(0, 10) + '.csv'
      );
      UI.toast('已导出 ' + label + ' ' + items.length + ' 条');
    };

    // ---- 导入 ----
    let picked = null;
    c.querySelector('#file').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      picked = f;
      UI.toast('已选择：' + f.name);
    };

    // 下载空白模板（中文表头，Excel / WPS 直接填）
    c.querySelector('#tplBtn').onclick = () => {
      const col = c.querySelector('#impCol').value;
      const spec = window.CSV.EXPORT_FIELDS[col];
      const label = COLS.filter((x) => x[0] === col)[0][1];
      download(
        new Blob(['﻿' + spec.map((f) => f.t).join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' }),
        '模板_' + label + '.csv'
      );
      UI.toast('已下载「' + label + '」模板，第一行表头别动，从第二行开始填');
    };

    c.querySelector('#impBtn').onclick = async () => {
      if (!picked) return UI.toast('请先选择文件');
      const name = picked.name.toLowerCase();
      try {
        if (name.endsWith('.json')) {
          const obj = JSON.parse(await picked.text());
          UI.confirmBox('JSON 恢复会覆盖当前全部数据，确定继续？（建议先导出现有备份）', async () => {
            await API.importAll(obj);
            UI.toast('已恢复备份');
            setTimeout(() => location.reload(), 800);
          });
          return;
        }
        if (name.endsWith('.csv')) {
          const text = await picked.text();
          const col = c.querySelector('#impCol').value;
          const spec = window.CSV.EXPORT_FIELDS[col];
          const recs = window.CSV.csvToCol(col, text);
          if (!recs.length) return UI.toast('CSV 里没有可导入的记录');
          const label = COLS.filter((x) => x[0] === col)[0][1];
          const prev = recs.slice(0, 5).map((r, i) => `<tr><td>${i + 1}</td>` +
            spec.map((f) => `<td>${UI.esc(r[f.k] === true ? '是' : r[f.k] === false ? '否' : (r[f.k] ?? ''))}</td>`).join('') +
            '</tr>').join('');
          UI.modal('导入预览', `
            <p style="margin:0 0 8px">将从「${UI.esc(picked.name)}」向<b>${UI.esc(label)}</b>追加 <b>${recs.length}</b> 条记录：</p>
            <div style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:8px">
              <table class="tbl" style="margin:0"><thead><tr><th>#</th>${spec.map((f) => `<th>${UI.esc(f.t)}</th>`).join('')}</tr></thead><tbody>${prev}</tbody></table>
            </div>
            ${recs.length > 5 ? `<p style="color:var(--muted);font-size:12.5px;margin:8px 0 0">仅预览前 5 条，实际导入全部 ${recs.length} 条。</p>` : ''}
          `, [
            { text: '取消', onClick: UI.closeModal },
            {
              text: '确认导入', cls: 'primary',
              onClick: async () => {
                UI.closeModal();
                for (const r of recs) await API.add(col, r);
                UI.toast('已导入 ' + recs.length + ' 条');
                UI.modal('导入完成', `<p style="margin:0">已向「${UI.esc(label)}」导入 <b>${recs.length}</b> 条记录。数据有变化，建议马上去风险清单重新扫描。</p>`, [
                  { text: '留在本页', onClick: () => { UI.closeModal(); location.reload(); } },
                  { text: '去风险清单扫描', cls: 'primary', onClick: () => { UI.closeModal(); location.hash = '#/risk'; } },
                ]);
              },
            },
          ]);
          return;
        }
        UI.toast('只支持 .json / .csv');
      } catch (e) {
        UI.toast('导入失败：' + e.message);
      }
    };

    c.querySelector('#rst').onclick = () =>
      UI.confirmBox('将清空当前全部数据，恢复演示数据，确定？', async () => {
        await API.reset();
        UI.toast('已恢复');
        setTimeout(() => location.reload(), 600);
      });
  },
};

/* ============ 地区与判定标准（原系统设置的「所在地区 + 风险判定阈值」） ============ */
PAGES.regionset = {
  title: '地区与判定标准',
  async render(c) {
    const [s, , rg] = await Promise.all([
      API.settings(), Promise.resolve({}),
      API.get('/api/regions').catch(() => ({ regions: [] })),
    ]);
    const regions = rg.regions || [];
    const cur = s.region || '';

    // 已存地区在列表里没有（比如手填过的"宁夏银川"），补一个自定义项
    const inList = regions.some((r) => r.name === cur || cur.indexOf(r.name) === 0);

    c.innerHTML = `
      <div class="card">
        <h2>风险判定阈值</h2>
        <p style="color:var(--muted);font-size:13px;margin:0 0 10px">
          选好地区后，下方会自动带出当地的用工标准（最低工资等），带出的数字可以手工改。
        </p>
        <div class="form-grid">
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
          <label>当地最低工资（元/月）<input id="minWage" type="number" value="${UI.esc(s.minWage ?? 0)}" /></label>
          <label>最低工资档位
            <select id="tierSel"><option value="">（手动填写时不选）</option></select>
          </label>
          <label>签约期限（天，超过即算未签合同）<input id="signDeadlineDays" type="number" value="${UI.esc(s.signDeadlineDays ?? 30)}" /></label>
          <label>合同到期提醒（天）<input id="contractExpireDays" type="number" value="${UI.esc(s.contractExpireDays ?? 30)}" /></label>
          <label>月加班上限（小时）<input id="overtimeLimitMonth" type="number" value="${UI.esc(s.overtimeLimitMonth ?? 36)}" /></label>
          <label>证照到期提醒（天）<input id="certExpireDays" type="number" value="${UI.esc(s.certExpireDays ?? 30)}" /></label>
        </div>
        <div id="regionInfo" style="margin-top:12px"></div>
        <div class="toolbar" style="margin-top:12px"><button class="btn primary" id="save">保存</button></div>
      </div>`;

    // ---- 地区 → 自动带出当地用工标准 ----
    const regionSel = c.querySelector('#region');
    const infoBox = c.querySelector('#regionInfo');
    const tierSel = c.querySelector('#tierSel');
    const minWageInput = c.querySelector('#minWage');
    const CN = ['一', '二', '三', '四', '五'];
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
        region: c.querySelector('#region').value,
        signDeadlineDays: num('signDeadlineDays'),
        contractExpireDays: num('contractExpireDays'),
        overtimeLimitMonth: num('overtimeLimitMonth'),
        minWage: num('minWage'),
        certExpireDays: num('certExpireDays'),
      });
      UI.toast('已保存');
      APP.loadHealth();
      APP.renderNav();
    };
  },
};

/* ============ 系统设置（只剩 AI 密钥配置） ============ */
PAGES.setting = {
  title: '系统设置',
  async render(c) {
    const h = await API.health().catch(() => ({}));

    c.innerHTML = `
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
