/**
 * 用工风险扫描引擎（网页版重新实现，非搬运小程序代码）
 *
 * 规则三类：
 *   auto   10 条 —— 用系统里的真实数据直接算（能下钻到具体哪个人）
 *   ask   105 条 —— 系统算不出，走问卷答案或法务确认台账
 *   hybrid  1 条 —— 两者结合
 *
 * 法律口径（与既有库一致）：
 *   试用期上限：3个月以下不得约定 / 3月~1年 1个月 / 1年~3年 2个月 / 3年以上及无固定期限 6个月
 *              以完成一定工作任务为期限的、期限不满3个月的，不得约定试用期
 *   加班上限：每月 36 小时（劳动法第41条）
 *   试用期工资：不低于本单位同岗最低档或合同约定工资的 80%，且不低于当地最低工资
 */
const RULES = require('../data/rules.json');
const RULE_BY_ID = {};
RULES.forEach((r) => (RULE_BY_ID[r.id] = r));

/** 取已核验规则里的法条等元信息（保证法条来自库，不自行编造） */
function metaOf(baseId, fallback) {
  const b = RULE_BY_ID[baseId];
  return {
    law: (b && b.law) || [],
    consequence: (b && b.consequence) || (fallback && fallback.consequence) || '',
    remedy: (b && b.remedy) || (fallback && fallback.remedy) || [],
    sev: (b && b.sev) || (fallback && fallback.sev) || '中',
  };
}

const DAY = 86400000;
function toDate(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}
function days(a, b) {
  return Math.floor((toDate(b) - toDate(a)) / DAY);
}

/** 试用期法定上限（月） */
function probationLimit(c) {
  if (!c) return 0;
  if (c.type === 'open') return 6;          // 无固定期限
  if (c.type === 'task') return 0;          // 以完成一定工作任务为期限
  const m = Number(c.months) || 0;
  if (m < 3) return 0;
  if (m < 12) return 1;
  if (m < 36) return 2;
  return 6;
}

const typeName = { fixed: '固定期限', open: '无固定期限', task: '以完成一定工作任务为期限' };

function empMap(employees) {
  const m = {};
  (employees || []).forEach((e) => (m[e._id] = e));
  return m;
}
function nameOf(e) {
  return e && e.name ? e.name : '未填写';
}
function deptOf(e) {
  return e && e.dept ? e.dept : '未填部门';
}

/* ============ 10 条 auto 规则的判定（各返回命中人员明细） ============ */
const AUTO = {
  // 自用工之日起超过一个月未订立书面劳动合同
  'R-ENTRY-01'(ctx) {
    const signed = {};
    (ctx.contracts || []).forEach((c) => c.employeeId && (signed[c.employeeId] = true));
    const limit = ctx.cfg.signDeadlineDays || 30;
    return (ctx.employees || [])
      .filter((e) => e.status !== 'left' && !signed[e._id] && days(e.entryDate, ctx.today) > limit)
      .map((e) => ({
        employeeId: e._id, name: nameOf(e), dept: deptOf(e),
        detail: `入职 ${days(e.entryDate, ctx.today)} 天，无合同记录`,
      }));
  },

  // 约定的试用期超过法定上限
  'R-ENTRY-02'(ctx) {
    const emps = empMap(ctx.employees);
    return (ctx.contracts || [])
      .filter((c) => Number(c.probationMonths) > probationLimit(c))
      .map((c) => {
        const e = emps[c.employeeId] || {};
        return {
          employeeId: c.employeeId, name: nameOf(e), dept: deptOf(e),
          detail: `${typeName[c.type] || '未填类型'}合同，法定上限 ${probationLimit(c)} 个月，实际约定 ${c.probationMonths} 个月`,
        };
      });
  },

  // 劳动合同即将到期（同一员工取最近到期的一份，避免重复计数）
  'R-ENTRY-03'(ctx) {
    const emps = empMap(ctx.employees);
    const ahead = ctx.cfg.contractExpireDays || 30;
    const nearest = {};
    (ctx.contracts || []).forEach((c) => {
      if (!c.endDate) return;
      const d = days(ctx.today, c.endDate);
      if (d < 0 || d > ahead) return;
      if (!nearest[c.employeeId] || d < nearest[c.employeeId].d) nearest[c.employeeId] = { d, c };
    });
    return Object.keys(nearest).map((id) => {
      const e = emps[id] || {};
      return {
        employeeId: id, name: nameOf(e), dept: deptOf(e),
        detail: `合同 ${nearest[id].d} 天后到期`,
      };
    });
  },

  // 连续订立二次固定期限合同后，仍未订立无固定期限合同
  'R-ENTRY-04'(ctx) {
    const emps = empMap(ctx.employees);
    const byEmp = {};
    (ctx.contracts || []).forEach((c) => {
      if (c.type !== 'fixed') return;
      (byEmp[c.employeeId] = byEmp[c.employeeId] || []).push(c);
    });
    const out = [];
    Object.keys(byEmp).forEach((id) => {
      const list = byEmp[id];
      if (list.length < 2) return;
      const hasOpen = (ctx.contracts || []).some((c) => c.employeeId === id && c.type === 'open');
      if (hasOpen) return;
      const e = emps[id] || {};
      if (e.status === 'left') return;
      out.push({
        employeeId: id, name: nameOf(e), dept: deptOf(e),
        detail: `已连续订立 ${list.length} 次固定期限合同，当前仍为固定期限`,
      });
    });
    return out;
  },

  // 月加班超过 36 小时
  'R-HOURS-01'(ctx) {
    const emps = empMap(ctx.employees);
    const limit = ctx.cfg.overtimeLimitMonth || 36;
    return (ctx.attendances || [])
      .filter((a) => Number(a.overtimeHours) > limit)
      .map((a) => {
        const e = emps[a.employeeId] || {};
        return {
          employeeId: a.employeeId, name: nameOf(e), dept: deptOf(e),
          detail: `${a.month || '本期'}加班 ${a.overtimeHours} 小时，超过 ${limit} 小时上限`,
        };
      });
  },

  // 月工资低于当地最低工资标准
  'R-WAGE-01'(ctx) {
    const mw = Number(ctx.cfg.minWage) || 0;
    if (!mw) return [];
    const emps = empMap(ctx.employees);
    return (ctx.payrolls || [])
      .filter((p) => Number(p.amount) > 0 && Number(p.amount) < mw)
      .map((p) => {
        const e = emps[p.employeeId] || {};
        return {
          employeeId: p.employeeId, name: nameOf(e), dept: deptOf(e),
          detail: `月工资 ${p.amount} 元，低于当地最低工资 ${mw} 元`,
        };
      });
  },

  // 存在加班但未计发加班费
  'R-WAGE-02'(ctx) {
    const emps = empMap(ctx.employees);
    const otMap = {};
    (ctx.attendances || []).forEach((a) => {
      otMap[a.employeeId] = (otMap[a.employeeId] || 0) + (Number(a.overtimeHours) || 0);
    });
    const payMap = {};
    (ctx.payrolls || []).forEach((p) => {
      payMap[p.employeeId] = (payMap[p.employeeId] || 0) + (Number(p.overtimePay) || 0);
    });
    const out = [];
    Object.keys(otMap).forEach((id) => {
      if (otMap[id] > 0 && !payMap[id]) {
        const e = emps[id] || {};
        out.push({
          employeeId: id, name: nameOf(e), dept: deptOf(e),
          detail: `有加班 ${otMap[id]} 小时，未见加班费发放记录`,
        });
      }
    });
    return out;
  },

  // 未依法为劳动者缴纳社会保险
  'R-SOCIAL-01'(ctx) {
    const insured = {};
    (ctx.socials || []).forEach((s) => (insured[s.employeeId] = !!s.insured));
    return (ctx.employees || [])
      .filter((e) => e.status !== 'left' && !insured[e._id])
      .map((e) => ({
        employeeId: e._id, name: nameOf(e), dept: deptOf(e),
        detail: '在职但无参保记录',
      }));
  },

  // 离职未出具解除或终止劳动合同证明
  'R-LEAVE-01'(ctx) {
    return (ctx.employees || [])
      .filter((e) => e.status === 'left' && !e.leaveProof)
      .map((e) => ({
        employeeId: e._id, name: nameOf(e), dept: deptOf(e),
        detail: '已离职，无离职证明出具记录',
      }));
  },

  // 试用期工资低于本单位相同岗位最低档工资或合同约定工资的 80%
  'R-PROB-01'(ctx) {
    const emps = empMap(ctx.employees);
    return (ctx.payrolls || [])
      .filter((p) => p.probation && Number(p.formalAmount) > 0 && Number(p.amount) < Number(p.formalAmount) * 0.8)
      .map((p) => {
        const e = emps[p.employeeId] || {};
        return {
          employeeId: p.employeeId, name: nameOf(e), dept: deptOf(e),
          detail: `试用期工资 ${p.amount} 元，低于转正工资 ${p.formalAmount} 元的 80%（${Math.round(p.formalAmount * 0.8)} 元）`,
        };
      });
  },
};

/* ============ 扩充的自动测算规则 ============
 * 这些规则不需要人工确认，直接由导入的数据算出来。
 * 法条一律复用已核验规则库（rules.json）里对应条目的原文，不另行编写。
 */
const EXTRA_RULES = [
  {
    id: 'R-ENTRY-05',
    cat: 'entry_sign', catLabel: '合同签订', base: 'R-SIGN-01', sev: '高',
    risk: '劳动合同已到期但仍在用工（未及时续签）',
    consequence: '期满未续签继续用工的，形成事实劳动关系，同样面临二倍工资风险',
    remedy: ['到期前完成续签', '已超期的立即补签并留存补签说明'],
    module: 'contract',
    pick(ctx) {
      const emps = empMap(ctx.employees);
      const latest = {};
      (ctx.contracts || []).forEach((c) => {
        if (!c.endDate) return;
        if (!latest[c.employeeId] || toDate(c.endDate) > toDate(latest[c.employeeId].endDate)) {
          latest[c.employeeId] = c;
        }
      });
      const out = [];
      Object.keys(latest).forEach((id) => {
        const e = emps[id] || {};
        if (e.status === 'left') return;
        const c = latest[id];
        if (toDate(c.endDate) < ctx.today) {
          out.push({
            employeeId: id, name: nameOf(e), dept: deptOf(e),
            detail: `合同已于 ${fmt(toDate(c.endDate))} 到期，仍继续用工 ${days(c.endDate, ctx.today)} 天`,
          });
        }
      });
      return out;
    },
  },

  {
    id: 'R-SIGN-02-AUTO',  // 不与规则库 ask 题 R-SIGN-02 撞号
    cat: 'entry_sign', catLabel: '合同签订', base: 'R-SIGN-06', sev: '高',
    risk: '用工满一年仍未订立书面劳动合同（视为已订立无固定期限合同）',
    consequence: '视为已订立无固定期限劳动合同，且应当支付最多 11 个月的二倍工资',
    remedy: ['立即补签无固定期限劳动合同', '核算 11 个月二倍工资敞口'],
    module: 'contract',
    pick(ctx) {
      const signed = {};
      (ctx.contracts || []).forEach((c) => c.employeeId && (signed[c.employeeId] = true));
      return (ctx.employees || [])
        .filter((e) => e.status !== 'left' && !signed[e._id] && days(e.entryDate, ctx.today) >= 365)
        .map((e) => ({
          employeeId: e._id, name: nameOf(e), dept: deptOf(e),
          detail: `入职 ${days(e.entryDate, ctx.today)} 天（已满一年），始终无书面合同`,
        }));
    },
  },

  {
    id: 'R-WELFARE-04-AUTO',  // 不与规则库 ask 题 R-WELFARE-04 撞号
    cat: 'entry_welfare', catLabel: '法定福利', base: 'R-WELFARE-02', sev: '中',
    risk: '社保缴费基数低于本人工资（未足额缴纳）',
    consequence: '由征收机构责令限期缴纳或补足，并自欠缴之日起加收滞纳金；逾期不缴的处罚款',
    remedy: ['按实际工资核定缴费基数', '核算差额与滞纳金'],
    module: 'social',
    pick(ctx) {
      const emps = empMap(ctx.employees);
      const wage = {};
      (ctx.payrolls || []).forEach((p) => {
        if (p.employeeId) wage[p.employeeId] = Math.max(wage[p.employeeId] || 0, Number(p.amount) || 0);
      });
      return (ctx.socials || [])
        .filter((s) => s.insured && Number(s.base) > 0 && wage[s.employeeId] && Number(s.base) < wage[s.employeeId])
        .map((s) => {
          const e = emps[s.employeeId] || {};
          return {
            employeeId: s.employeeId, name: nameOf(e), dept: deptOf(e),
            detail: `月工资 ${wage[s.employeeId]} 元，缴费基数仅 ${s.base} 元`,
          };
        });
    },
  },

  {
    id: 'R-PROB-03-AUTO',  // 不与规则库 ask 题 R-PROB-03 撞号
    cat: 'probation', catLabel: '试用期', base: 'R-PROB-02', sev: '高',
    risk: '试用期工资低于用人单位所在地最低工资标准',
    consequence: '由劳动行政部门责令支付差额部分；逾期不支付的，责令加付赔偿金',
    remedy: ['补足至当地最低工资标准'],
    module: 'payroll',
    pick(ctx) {
      const mw = Number(ctx.cfg.minWage) || 0;
      if (!mw) return [];
      const emps = empMap(ctx.employees);
      return (ctx.payrolls || [])
        .filter((p) => p.probation && Number(p.amount) > 0 && Number(p.amount) < mw)
        .map((p) => {
          const e = emps[p.employeeId] || {};
          return {
            employeeId: p.employeeId, name: nameOf(e), dept: deptOf(e),
            detail: `试用期工资 ${p.amount} 元，低于当地最低工资 ${mw} 元`,
          };
        });
    },
  },

  {
    id: 'R-WAGE-04-AUTO',  // 不与规则库 ask 题 R-WAGE-04 撞号
    cat: 'entry_wage', catLabel: '工资', base: 'R-WAGE-02', sev: '中',
    risk: '加班费明显低于法定标准（低于正常小时工资的 1 倍）',
    consequence: '劳动者可主张补足加班费差额，存在集体争议风险',
    remedy: ['按 150% / 200% / 300% 重新核算加班费', '规范加班审批与工时记录'],
    module: 'payroll',
    pick(ctx) {
      const emps = empMap(ctx.employees);
      const ot = {};
      (ctx.attendances || []).forEach((a) => {
        ot[a.employeeId] = (ot[a.employeeId] || 0) + (Number(a.overtimeHours) || 0);
      });
      const out = [];
      (ctx.payrolls || []).forEach((p) => {
        const hours = ot[p.employeeId] || 0;
        const pay = Number(p.overtimePay) || 0;
        const monthWage = Number(p.amount) || 0;
        if (!hours || !monthWage) return;
        // 保守口径：小时工资按 月工资 ÷ 21.75 ÷ 8，连 1 倍都不到才算明显不足（避免误报）
        const hourly = monthWage / 21.75 / 8;
        if (pay > 0 && pay < hourly * hours) {
          const e = emps[p.employeeId] || {};
          out.push({
            employeeId: p.employeeId, name: nameOf(e), dept: deptOf(e),
            detail: `加班 ${hours} 小时，加班费 ${pay} 元，低于小时工资 ${hourly.toFixed(1)} 元 × ${hours} 小时`,
          });
        }
      });
      return out;
    },
  },
];

function fmt(ts) {
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 证照到期提醒（不属 116 条规则，归"证照资质"模块的到期提醒） */
function certExpiring(ctx) {
  const emps = empMap(ctx.employees);
  const ahead = ctx.cfg.certExpireDays || 30;
  return (ctx.certs || [])
    .filter((c) => {
      const d = days(ctx.today, c.expireDate);
      return d >= 0 && d <= ahead;
    })
    .map((c) => {
      const e = emps[c.employeeId] || {};
      return {
        employeeId: c.employeeId, name: nameOf(e), dept: deptOf(e),
        detail: `「${c.name || '证照'}」${days(ctx.today, c.expireDate)} 天后到期`,
      };
    });
}

/**
 * 扫描主入口
 * @param {object} data  {employees, contracts, attendances, payrolls, socials, certs, settings, ruleCfg, confirms, surveys}
 * @returns {Array} 风险清单（每项含命中人员明细，可下钻）
 */
function scan(data) {
  const cfg = Object.assign(
    { signDeadlineDays: 30, contractExpireDays: 30, overtimeLimitMonth: 36, certExpireDays: 30, minWage: 0 },
    data.settings || {}
  );
  const ctx = {
    employees: data.employees || [],
    contracts: data.contracts || [],
    attendances: data.attendances || [],
    payrolls: data.payrolls || [],
    socials: data.socials || [],
    certs: data.certs || [],
    cfg,
    today: Date.now(),
  };

  const ruleCfg = data.ruleCfg || {};
  // ask 类答案来源：法务确认台账 + 问卷答案（后者优先级低）
  const answers = Object.assign({}, data.surveys || {}, data.confirms || {});

  const items = [];

  RULES.forEach((rule) => {
    const over = ruleCfg[rule.id];
    const enabled = over && over.enabled !== undefined ? over.enabled : rule.enabled;
    if (!enabled) return;

    if (rule.level === 'auto' && AUTO[rule.id]) {
      const people = AUTO[rule.id](ctx);
      if (!people.length) return;
      items.push({
        ruleId: rule.id,
        level: 'auto',
        source: '数据扫描',
        cat: rule.cat,
        catLabel: rule.catLabel,
        risk: rule.risk,
        sev: rule.sev,
        law: rule.law,
        consequence: rule.consequence,
        remedy: rule.remedy,
        owner: rule.owner,
        module: rule.module,
        count: people.length,
        people,
      });
      return;
    }

    // ask / hybrid：看台账或问卷答案
    const ans = answers[rule.id];
    if (ans && (ans.answer === 'no' || ans.answer === 'unsure')) {
      items.push({
        ruleId: rule.id,
        level: rule.level,
        source: '台账/问卷',
        cat: rule.cat,
        catLabel: rule.catLabel,
        risk: rule.risk,
        sev: rule.sev,
        law: rule.law,
        consequence: rule.consequence,
        remedy: rule.remedy,
        owner: rule.owner,
        module: rule.module,
        answer: ans.answer,
        answerBy: ans.by || ans.confirmedBy || '',
        answerAt: ans.at || ans.confirmedAt || 0,
        note: ans.note || '',
        count: 0,
        people: [],
      });
    }
  });

  // 扩充的自动测算规则
  EXTRA_RULES.forEach((r) => {
    const people = r.pick(ctx);
    if (!people.length) return;
    const meta = metaOf(r.base, r);
    items.push({
      ruleId: r.id,
      level: 'auto',
      source: '数据扫描',
      cat: r.cat,
      catLabel: r.catLabel,
      risk: r.risk,
      sev: r.sev || meta.sev,
      law: meta.law,
      consequence: r.consequence || meta.consequence,
      remedy: r.remedy && r.remedy.length ? r.remedy : meta.remedy,
      owner: 'hr',
      module: r.module || '',
      count: people.length,
      people,
    });
  });

  // 证照到期提醒并入清单
  const cp = certExpiring(ctx);
  if (cp.length) {
    items.push({
      ruleId: 'CERT-EXPIRE',
      level: 'auto',
      source: '数据扫描',
      cat: 'cert',
      catLabel: '证照资质',
      risk: '特种作业/特种设备证照即将到期',
      sev: '中',
      law: [{ ref: '《特种作业人员安全技术培训考核管理规定》', text: '特种作业操作证有效期 6 年，每 3 年复审一次；逾期未复审的，证书失效。' }],
      consequence: '无证上岗或证件失效的，责令限期改正，可处罚款；发生事故的从重追责',
      remedy: ['提前 30 天安排复审', '建立证照到期台账'],
      owner: 'hr',
      module: 'cert',
      count: cp.length,
      people: cp,
    });
  }

  // 排序：先按严重程度，再按命中人数
  const rank = { 高: 0, 中: 1, 低: 2 };
  items.sort((a, b) => (rank[a.sev] ?? 9) - (rank[b.sev] ?? 9) || b.count - a.count);
  return items;
}

module.exports = { scan, probationLimit, RULES };
