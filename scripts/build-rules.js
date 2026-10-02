/**
 * 生成网页版规则库 data/rules.json
 *
 * 说明（重要，涉及"原创代码"红线）：
 *  - 规则内容（风险描述 / 法条 / 后果 / 整改）属于劳动法知识资产，沿用既有已核验结论；
 *  - 判定逻辑（engine.js 里的算法）在网页版中**重新实现**，不搬运小程序代码。
 */
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/Administrator/WorkBuddy/Claw/labor-system-miniprogram/miniprogram/data';
const riskMod = require(path.join(SRC, 'riskRules.js'));
const entMod = require(path.join(SRC, 'enterpriseRiskLibrary.js'));

const CATS = entMod.CATEGORIES || [];
const catLabel = {};
CATS.forEach((c) => (catLabel[c.key] = c.label));

const sevMap = {};
(entMod.RISKS || []).forEach((r) => (sevMap[r.id] = r.sev));

const ALL = riskMod.ALL_RULES || riskMod.RULES || [];

const rules = ALL.map((r) => ({
  id: r.id,
  cat: r.cat || '',
  catLabel: catLabel[r.cat] || r.cat || '',
  risk: r.risk || '',
  level: r.level || 'ask',
  owner: r.owner || 'hr',
  module: r.module || '',
  enabled: r.enabled !== false,
  q: r.q || '',
  law: (r.law || []).map((l) => ({ ref: l.ref || '', text: l.text || '' })),
  consequence: r.consequence || '',
  remedy: Array.isArray(r.remedy) ? r.remedy : r.remedy ? [String(r.remedy)] : [],
  sev: sevMap[r.id] || (r.level === 'auto' ? '高' : '中'),
}));

const outDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'rules.json'), JSON.stringify(rules, null, 2));

const byLevel = rules.reduce((m, r) => ((m[r.level] = (m[r.level] || 0) + 1), m), {});
console.log(`rules.json 已生成：${rules.length} 条`, JSON.stringify(byLevel));
