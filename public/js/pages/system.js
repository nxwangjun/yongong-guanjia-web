/* 系统模块：数据导入导出 / 系统设置（免登录 A1 版：数据全部在本浏览器 localStorage） */
window.PAGES = window.PAGES || {};

/* ============ 数据导入导出（六表合并为单文件） ============ */
PAGES.dataio = {
  title: '数据导入导出',
  async render(c) {
    c.innerHTML = `
      <div class="card">
        <h2>导出</h2>
        <p style="color:var(--muted);font-size:13px">
          所有数据只存在本浏览器里。建议定期导出备份，换电脑或清浏览器数据前导一次。
        </p>
        <div class="toolbar">
          <button class="btn primary" id="expCsv">导出 CSV（六表合一，Excel / WPS 可打开）</button>
          <button class="btn" id="expJson">导出 JSON 备份（含台账/问卷答案）</button>
        </div>
      </div>

      <div class="card">
        <h2>导入</h2>
        <p style="color:var(--muted);font-size:13px">
          <b>.csv</b>：一个文件装六张表（员工/劳动合同/考勤/薪资/社保/证照，分段存放）。
          先「下载模板」——模板里每张表都给了 1 行示例，照着格式把自己的数据填进去（示例行可不删，导入时自动跳过）。<br/>
          <b>.json</b>：整体恢复备份（覆盖当前全部数据，导入前会先让你确认）。
        </p>
        <div class="toolbar" style="margin-top:6px">
          <input type="file" id="file" accept=".csv,.json" />
          <button class="btn" id="tplBtn">下载模板（含填写示例）</button>
          <button class="btn primary" id="impBtn">确认导入</button>
        </div>
        <p style="color:var(--muted);font-size:12.5px;margin:8px 0 0">
          CSV 导入为<b>追加</b>模式：新记录直接加入，不影响已有数据。导入前会先弹预览，确认无误才入库。
        </p>
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
      const dataByCol = {};
      let total = 0;
      for (const col of window.CSV.COL_ORDER) {
        dataByCol[col] = await API.list(col);
        total += dataByCol[col].length;
      }
      const text = window.CSV.allToCsv(dataByCol, false);
      download(
        new Blob([text], { type: 'text/csv;charset=utf-8' }),
        '小哲用工风险检测_全部数据_' + new Date().toISOString().slice(0, 10) + '.csv'
      );
      UI.toast('已导出六表合一 CSV，共 ' + total + ' 条');
    };

    // ---- 导入 ----
    let picked = null;
    c.querySelector('#file').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      picked = f;
      UI.toast('已选择：' + f.name);
    };

    // 下载合并模板（六表各带 1 行示例）
    c.querySelector('#tplBtn').onclick = () => {
      const text = window.CSV.allToCsv(null, true);
      download(
        new Blob([text], { type: 'text/csv;charset=utf-8' }),
        '模板_用工数据六表合一.csv'
      );
      UI.toast('模板已下载：每张表给了 1 行示例，照着填即可，示例行可不删');
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
          const byCol = window.CSV.csvToAll(text);
          const cols = Object.keys(byCol).filter((k) => byCol[k].length);
          if (!cols.length) {
            return UI.toast('CSV 里没有可导入的记录（请用本站下载的模板，段头 #员工 等行别删）');
          }
          const totalCnt = cols.reduce((s, k) => s + byCol[k].length, 0);
          const summary = cols
            .map((k) => `<tr><td>${UI.esc(window.CSV.COL_LABELS[k] || k)}</td><td style="text-align:right"><b>${byCol[k].length}</b> 条</td></tr>`)
            .join('');
          const firstCol = cols[0];
          const spec = window.CSV.EXPORT_FIELDS[firstCol];
          const prev = byCol[firstCol].slice(0, 5).map((r, i) => `<tr><td>${i + 1}</td>` +
            spec.map((f) => `<td>${UI.esc(r[f.k] === true ? '是' : r[f.k] === false ? '否' : (r[f.k] ?? ''))}</td>`).join('') +
            '</tr>').join('');
          UI.modal('导入预览', `
            <p style="margin:0 0 8px">将从「${UI.esc(picked.name)}」导入 <b>${totalCnt}</b> 条记录，分布如下：</p>
            <table class="tbl" style="margin:0 0 10px"><tbody>${summary}</tbody></table>
            <p style="margin:0 0 6px;color:var(--muted);font-size:12.5px">「${UI.esc(window.CSV.COL_LABELS[firstCol])}」表前 ${Math.min(5, byCol[firstCol].length)} 条预览：</p>
            <div style="max-height:200px;overflow:auto;border:1px solid var(--border);border-radius:8px">
              <table class="tbl" style="margin:0"><thead><tr><th>#</th>${spec.map((f) => `<th>${UI.esc(f.t)}</th>`).join('')}</tr></thead><tbody>${prev}</tbody></table>
            </div>
          `, [
            { text: '取消', onClick: UI.closeModal },
            {
              text: '确认导入', cls: 'primary',
              onClick: async () => {
                UI.closeModal();
                for (const col of cols) for (const r of byCol[col]) await API.add(col, r);
                UI.toast('已导入 ' + totalCnt + ' 条');
                UI.modal('导入完成', `<p style="margin:0">已导入 <b>${totalCnt}</b> 条记录（${cols.map((k) => UI.esc(window.CSV.COL_LABELS[k] || k)).join('、')}）。数据有变化，建议马上去用工风险清单重新扫描。</p>`, [
                  { text: '留在本页', onClick: () => { UI.closeModal(); location.reload(); } },
                  { text: '去用工风险清单扫描', cls: 'primary', onClick: () => { UI.closeModal(); location.hash = '#/risk'; } },
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
  },
};

/* ============ 判定阈值（所在地区 + 风险判定阈值） ============ */
PAGES.regionset = {
  title: '判定阈值',
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

/* ============ 系统信息（AI 密钥配置 + 系统状态） ============ */
PAGES.setting = {
  title: '系统信息',
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
      </div>
      <div class="card">
        <h2>系统状态</h2>
        <table class="tbl">
          <tr><td style="width:160px;color:var(--muted)">大模型（AI）</td><td>${h.llmEnabled
            ? '<span class="tag green">已接入 ' + UI.esc(h.model) + '</span>'
            : '<span class="tag orange">未配置密钥，本地规则引擎兜底</span>'}</td></tr>
          <tr><td style="color:var(--muted)">劳动法知识库</td><td>${h.corpusSize ?? 0} 条（法条 / 规则 / 风险点）</td></tr>
          <tr><td style="color:var(--muted)">风险规则</td><td>${(() => {
            const all = (window.Engine.RULES || []).concat(window.Engine.EXTRA_RULE_LIST || []);
            const auto = all.filter((r) => r.level === 'auto').length;
            return `${all.length} 条（其中 ${auto} 条可由数据自动测算，其余走合规自查台账或问卷）`;
          })()}</td></tr>
          <tr><td style="color:var(--muted)">数据存储</td><td>仅存在本浏览器（localStorage），不上传服务器</td></tr>
        </table>
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
