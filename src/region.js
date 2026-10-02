/**
 * 地区用工环境（最低工资）—— 网页版实现
 *
 * 关键设计（沿用既有经验，避免踩坑）：
 *   已公布但尚未生效的新标准放在 pending，到生效日自动切换，**不提前生效**。
 *   直接改 tiers 会让生效日之前的企业按更高标准被误判「低于最低工资」→ 批量误报。
 *
 * 数据来源：人社部《全国各省最低工资标准情况》+ 各省人社厅文件，口径 2026-09-09。
 */
const DATA = require('../data/region.json');

function dateKey(d) {
  const x = d || new Date();
  const m = String(x.getMonth() + 1);
  const day = String(x.getDate());
  return x.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
}

/** 全部地区名 */
function names() {
  return Object.keys(DATA.regions || {});
}

/** 某地区「当天有效」的档位数组 */
function tiersAt(name, date) {
  const r = (DATA.regions || {})[name];
  if (!r || !r.tiers) return [];
  const p = r.pending;
  if (p && p.tiers && p.from && dateKey(date) >= p.from) return p.tiers;
  return r.tiers;
}

/** 待生效的新标准（已公布未实施） */
function pendingOf(name, date) {
  const r = (DATA.regions || {})[name];
  if (!r || !r.pending) return null;
  const p = r.pending;
  return { from: p.from, tiers: p.tiers, effective: dateKey(date) >= p.from };
}

/** 第一档（页面默认值） */
function first(name, date) {
  const t = tiersAt(name, date);
  return t.length ? t[0] : 0;
}

/** 档位标签 */
function tierLabel(i) {
  return ['第一档', '第二档', '第三档', '第四档'][i] || `第${i + 1}档`;
}

/** 数据来源说明 */
function srcText(name, date) {
  const r = (DATA.regions || {})[name];
  if (!r) return '';
  const p = pendingOf(name, date);
  const key = p && p.effective ? r.pending.src : r.src;
  return (DATA.sources || {})[key] || '';
}

/**
 * 该地区的基本用工环境描述（设置页自动带出用）
 * @returns {null|{name, tiers, first, note, pending, source, updated}}
 */
function profileOf(name, date) {
  const r = (DATA.regions || {})[name];
  if (!r) return null;
  const d = date || new Date();
  const tiers = tiersAt(name, d);
  const p = pendingOf(name, d);
  return {
    name,
    tiers,
    first: tiers.length ? tiers[0] : 0,
    note: r.tierNote || '',
    pending: p && !p.effective ? { from: p.from, tiers: p.tiers } : null,
    source: srcText(name, d),
    updated: DATA.updated,
  };
}

module.exports = {
  names, tiersAt, pendingOf, first, tierLabel, srcText, profileOf, dateKey,
  DATA_UPDATED: DATA.updated,
};
