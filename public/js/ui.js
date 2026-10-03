/* 前端通用 UI 组件 */
const UI = (() => {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => (t.style.display = 'none'), 2200);
  }

  function closeModal() {
    document.getElementById('modalMask').classList.remove('show');
    document.getElementById('modalBox').innerHTML = '';
  }

  /** 打开弹窗：html 为内容，buttons 为 [{text, cls, onClick(box)}] */
  function modal(title, html, buttons) {
    const box = document.getElementById('modalBox');
    box.innerHTML = `<h3>${esc(title)}</h3>${html}<div class="foot" id="modalFoot"></div>`;
    const foot = box.querySelector('#modalFoot');
    (buttons || [{ text: '关闭', onClick: closeModal }]).forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.textContent = b.text;
      btn.onclick = () => b.onClick && b.onClick(box);
      foot.appendChild(btn);
    });
    document.getElementById('modalMask').classList.add('show');
    return box;
  }

  function confirmBox(msg, onYes) {
    modal('确认', `<p style="margin:0">${esc(msg)}</p>`, [
      { text: '取消', onClick: closeModal },
      {
        text: '确定', cls: 'primary',
        onClick: () => {
          closeModal();
          onYes && onYes();
        },
      },
    ]);
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '—';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function toDateInput(ts) {
    return ts ? fmtDate(ts) : '';
  }
  function fromDateInput(v) {
    if (!v) return 0;
    const t = new Date(v + 'T00:00:00').getTime();
    return isNaN(t) ? 0 : t;
  }

  /* ---------- 通用 CRUD 页面 ---------- */
  /**
   * @param {object} cfg {title, col, fields:[{k,t,type,options,required}], desc, filter}
   *   field.type: text | number | date | select | emp | textarea | check
   */
  async function crudPage(container, cfg) {
    let keyword = '';
    let employees = [];
    if (cfg.fields.some((f) => f.type === 'emp')) {
      try {
        employees = await API.list('employees');
      } catch (e) {
        employees = [];
      }
    }

    async function load() {
      let items = await API.list(cfg.col);
      if (keyword) {
        const k = keyword.trim();
        items = items.filter((it) =>
          cfg.fields.some((f) => String(it[f.k] ?? '').includes(k))
        );
      }
      render(items);
    }

    function val(it, f) {
      let v = it[f.k];
      if (f.type === 'date') return fmtDate(v);
      if (f.type === 'select') {
        const o = (f.options || []).filter((x) => x[0] === v)[0];
        return o ? o[1] : v ?? '—';
      }
      if (f.type === 'emp') {
        const e = employees.filter((x) => x._id === v)[0];
        return e ? e.name : v || '—';
      }
      if (f.type === 'check') return v ? '是' : '否';
      return v ?? '—';
    }

    function render(items) {
      const cols = cfg.fields.slice(0, 6);
      container.innerHTML = `
        <div class="card">
          <div class="toolbar">
            <h2 style="margin:0">${esc(cfg.title)}</h2>
            <div class="spacer"></div>
            <input class="search" id="kw" placeholder="搜索…" value="${esc(keyword)}" />
            <button class="btn primary" id="btnAdd">+ 新增</button>
          </div>
          ${cfg.desc ? `<p style="color:var(--muted);font-size:13px;margin:0 0 10px">${esc(cfg.desc)}</p>` : ''}
          <p style="font-size:13px;margin:0 0 10px">
            <a href="#/risk" style="color:var(--primary);text-decoration:none">✅ 数据录完或改完 → 去「用工风险清单」重新扫描看结果 →</a>
          </p>
          <table class="tbl">
            <thead><tr>
              ${cols.map((f) => `<th>${esc(f.t)}</th>`).join('')}
              <th style="width:120px">操作</th>
            </tr></thead>
            <tbody>
              ${items.length
                ? items.map((it) => `
                  <tr>
                    ${cols.map((f) => `<td>${esc(val(it, f))}</td>`).join('')}
                    <td>
                      <button class="btn small" data-edit="${it._id}">编辑</button>
                      <button class="btn small danger" data-del="${it._id}">删除</button>
                    </td>
                  </tr>`).join('')
                : `<tr><td colspan="${cols.length + 1}" style="color:var(--muted);text-align:center;padding:20px">暂无数据</td></tr>`}
            </tbody>
          </table>
        </div>`;

      container.querySelector('#kw').oninput = (e) => {
        keyword = e.target.value;
        load();
        const el = container.querySelector('#kw');
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      };
      container.querySelector('#btnAdd').onclick = () => openForm(cfg.col, null, cfg, load);
      container.querySelectorAll('[data-edit]').forEach((b) =>
        (b.onclick = () => openForm(cfg.col, b.dataset.edit, cfg, load, items))
      );
      container.querySelectorAll('[data-del]').forEach((b) =>
        (b.onclick = () =>
          confirmBox('确定删除这条记录？', async () => {
            await API.remove(cfg.col, b.dataset.del);
            toast('已删除');
            load();
          }))
      );
    }

    await load();
  }

  async function openForm(col, id, cfg, onDone, items) {
    const editing = id ? (items || []).filter((x) => x._id === id)[0] : null;
    let employees = [];
    if (cfg.fields.some((f) => f.type === 'emp')) {
      try {
        employees = await API.list('employees');
      } catch (e) {
        employees = [];
      }
    }

    const fieldHtml = cfg.fields
      .map((f) => {
        const v = editing ? editing[f.k] : '';
        let input;
        if (f.type === 'select') {
          input = `<select name="${f.k}">${(f.options || [])
            .map((o) => `<option value="${o[0]}" ${String(v) === String(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`)
            .join('')}</select>`;
        } else if (f.type === 'emp') {
          input = `<select name="${f.k}">${employees
            .map((e) => `<option value="${e._id}" ${v === e._id ? 'selected' : ''}>${esc(e.name)}${e.dept ? '（' + esc(e.dept) + '）' : ''}</option>`)
            .join('')}</select>`;
        } else if (f.type === 'textarea') {
          input = `<textarea name="${f.k}">${esc(v)}</textarea>`;
        } else if (f.type === 'date') {
          input = `<input type="date" name="${f.k}" value="${toDateInput(v)}" />`;
        } else if (f.type === 'check') {
          input = `<select name="${f.k}"><option value="1" ${v ? 'selected' : ''}>是</option><option value="0" ${!v ? 'selected' : ''}>否</option></select>`;
        } else {
          input = `<input type="${f.type === 'number' ? 'number' : 'text'}" name="${f.k}" value="${esc(v)}" />`;
        }
        return `<label class="${f.type === 'textarea' ? 'full' : ''}">${esc(f.t)}${f.required ? ' *' : ''}${input}</label>`;
      })
      .join('');

    modal(
      (editing ? '编辑' : '新增') + cfg.title,
      `<div class="form-grid">${fieldHtml}</div>`,
      [
        { text: '取消', onClick: closeModal },
        {
          text: '保存', cls: 'primary',
          onClick: async (box) => {
            const data = {};
            box.querySelectorAll('[name]').forEach((el) => {
              const f = cfg.fields.filter((x) => x.k === el.name)[0];
              let v = el.value;
              if (f && f.type === 'number') v = v === '' ? 0 : Number(v);
              if (f && f.type === 'date') v = fromDateInput(v);
              if (f && f.type === 'check') v = v === '1';
              data[el.name] = v;
            });
            const miss = cfg.fields.filter((f) => f.required && !data[f.k]);
            if (miss.length) {
              toast('请填写：' + miss.map((f) => f.t).join('、'));
              return;
            }
            if (editing) await API.update(col, id, data);
            else await API.add(col, data);
            closeModal();
            toast('已保存');
            onDone && onDone();
          },
        },
      ]
    );
  }

  return { esc, toast, modal, closeModal, confirmBox, fmtDate, crudPage };
})();
