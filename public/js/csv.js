/* 浏览器端 CSV 导入导出（与 src/xlsx.js 的 CSV 部分同逻辑，另附导出字段定义）
   xlsx 的 zip/zlib 依赖 Node，不搬浏览器；纯前端用 JSON 备份 + CSV 单表导入导出。 */
window.CSV = (() => {
  const EXPORT_FIELDS = {
    employees: [
      { k: 'name', t: '姓名' }, { k: 'empNo', t: '工号' }, { k: 'dept', t: '部门' },
      { k: 'entryDate', t: '入职日期', d: 1 }, { k: 'status', t: '在职状态' },
    ],
    contracts: [
      { k: 'employeeId', t: '员工ID' }, { k: 'type', t: '合同类型' },
      { k: 'months', t: '期限(月)' }, { k: 'probationMonths', t: '试用期(月)' },
      { k: 'signDate', t: '签订日期', d: 1 }, { k: 'endDate', t: '到期日期', d: 1 },
    ],
    attendances: [
      { k: 'employeeId', t: '员工ID' }, { k: 'month', t: '月份' },
      { k: 'overtimeHours', t: '加班小时' }, { k: 'hours', t: '出勤小时' },
    ],
    payrolls: [
      { k: 'employeeId', t: '员工ID' }, { k: 'month', t: '月份' }, { k: 'amount', t: '月工资' },
      { k: 'overtimePay', t: '加班费' }, { k: 'probation', t: '试用期工资' },
      { k: 'formalAmount', t: '转正工资' },
    ],
    socials: [
      { k: 'employeeId', t: '员工ID' }, { k: 'insured', t: '已参保' }, { k: 'base', t: '缴纳基数' },
    ],
    certs: [
      { k: 'employeeId', t: '员工ID' }, { k: 'name', t: '证照名称' },
      { k: 'no', t: '证书编号' }, { k: 'expireDate', t: '有效期至', d: 1 },
    ],
  };

  function rowsToCsv(rows) {
    return (rows || []).map((r) =>
      (r || []).map((v) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',')
    ).join('\r\n');
  }

  function csvToRows(text) {
    const rows = [];
    let row = [];
    let cur = '';
    let inQ = false;
    const t = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (inQ) {
        if (ch === '"') {
          if (t[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && t[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
  }

  /* 集合 → CSV 文本（第一行中文表头，带 BOM 方便 Excel 直接打开） */
  function colToCsv(col, items) {
    const spec = EXPORT_FIELDS[col];
    if (!spec) throw new Error('不支持的集合：' + col);
    const rows = [spec.map((f) => f.t)];
    (items || []).forEach((it) => {
      rows.push(spec.map((f) => {
        let v = it[f.k];
        if (f.d && typeof v === 'number') {
          const dt = new Date(v);
          v = isNaN(dt) ? v : dt.toISOString().slice(0, 10);
        }
        if (typeof v === 'boolean') v = v ? '是' : '否';
        return v;
      }));
    });
    return '﻿' + rowsToCsv(rows);
  }

  /* CSV 文本 → 集合记录数组（按中文表头对回字段名，追加模式用） */
  function csvToCol(col, text) {
    const spec = EXPORT_FIELDS[col];
    if (!spec) throw new Error('不支持的集合：' + col);
    const rows = csvToRows(text);
    if (rows.length < 2) return [];
    const head = rows[0].map((h) => String(h).trim());
    const idx = spec.map((f) => head.indexOf(f.t));
    return rows.slice(1).map((r) => {
      const o = {};
      spec.forEach((f, i) => {
        let v = idx[i] >= 0 ? r[idx[i]] : '';
        if (v === '是') v = true;
        else if (v === '否') v = false;
        else if (f.k === 'months' || f.k === 'probationMonths' || f.k === 'overtimeHours' ||
                 f.k === 'hours' || f.k === 'amount' || f.k === 'overtimePay' ||
                 f.k === 'probation' || f.k === 'formalAmount' || f.k === 'base') {
          v = v === '' ? '' : Number(v);
        }
        o[f.k] = v;
      });
      return o;
    });
  }

  return { EXPORT_FIELDS, rowsToCsv, csvToRows, colToCsv, csvToCol };
})();
