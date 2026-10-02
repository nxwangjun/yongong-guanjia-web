/**
 * 语料构建脚本（一次性）
 *
 * 作用：把「用工管家」小程序里已经过元典核验的劳动法知识库
 *   - lawText.js（现行有效法条正文，元典核验 2026-09-08）
 *   - riskRules.js（116 条用工风险规则，含法条正文）
 *   - enterpriseRiskLibrary.js（104 条劳资风险自检点）
 * 抽取成两个干净的 JSON，供网页版 RAG 检索使用：
 *   - data/corpus.json：可被检索的法条 + 规则 + 风险点（统一结构）
 *   - data/quiz.json ：按 20 个子项目分组的自检问卷（前端引导式自检用）
 *
 * 复用既有知识，不重新发明法条；新工程仅做"检索 + 大模型诊断"这层。
 */
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/Administrator/WorkBuddy/Claw/labor-system-miniprogram/miniprogram/data';
const lawText = require(path.join(SRC, 'lawText.js'));
const riskMod = require(path.join(SRC, 'riskRules.js'));
const entMod = require(path.join(SRC, 'enterpriseRiskLibrary.js'));

const corpus = [];

// 1) 法条正文（lawText.js）：最权威的劳动法语料
const { LAW_META, LAW_TEXT } = lawText;
for (const key of Object.keys(LAW_TEXT)) {
  const meta = LAW_META[key] || {};
  const fgmc = meta.fgmc || meta.name || key;
  const arts = LAW_TEXT[key];
  for (const artNo of Object.keys(arts)) {
    corpus.push({
      id: `law:${key}:${artNo}`,
      type: 'law',
      source: fgmc,
      title: `${fgmc} 第${artNo}条`,
      text: arts[artNo],
      tags: [key],
    });
  }
}

// 2) 用工风险规则（116 条，自带法条正文）
const ALL = riskMod.ALL_RULES || riskMod.RULES || [];
for (const r of ALL) {
  const lawTexts = (r.law || [])
    .map((l) => `${l.ref || ''}\n${l.text || ''}`.trim())
    .filter(Boolean)
    .join('\n');
  const text = [r.risk, r.consequence, (r.remedy || []).join('；'), lawTexts]
    .filter(Boolean)
    .join('\n');
  corpus.push({
    id: `rule:${r.id}`,
    type: 'rule',
    source: '用工风险规则库',
    title: `${r.id}：${r.risk || ''}`,
    text,
    tags: [r.cat || '', r.level || ''].filter(Boolean),
  });
}

// 3) 劳资风险自检库（104 条风险点）
const RISKS = entMod.RISKS || [];
const CATS = entMod.CATEGORIES || [];
const catLabel = {};
CATS.forEach((c) => (catLabel[c.key] = c.label));
for (const r of RISKS) {
  const lawRefs = r.law || '';
  const remedy = (r.remedy && r.remedy.summary) || '';
  const text = [
    r.risk,
    '自查问题：' + (r.q || r.note || ''),
    '法律后果：' + (r.consequence || ''),
    '整改要点：' + remedy,
    '法律依据：' + lawRefs,
  ]
    .filter(Boolean)
    .join('\n');
  corpus.push({
    id: `risk:${r.id}`,
    type: 'risk',
    source: '劳资风险自检库',
    title: `${r.id}（${catLabel[r.cat] || r.cat}）：${r.risk || ''}`,
    text,
    tags: [r.cat || '', r.sev || ''],
  });
}

// 自检问卷：按子项目分组，优先取 priority，否则取前 3 条代表性问题
const quiz = CATS.map((c) => {
  const items = RISKS.filter((r) => r.cat === c.key);
  const pool = items.filter((r) => r.priority);
  const picked = (pool.length ? pool : items).slice(0, 3);
  return {
    key: c.key,
    label: c.label,
    flow: c.flow,
    desc: c.desc,
    questions: picked.map((r) => ({
      id: r.id,
      q: r.q || r.note || r.risk,
      sev: r.sev,
      law: r.law,
      risk: r.risk,
      consequence: r.consequence,
      remedy: (r.remedy && r.remedy.summary) || '',
    })),
  };
}).filter((c) => c.questions.length);

const outDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'corpus.json'), JSON.stringify(corpus));
fs.writeFileSync(path.join(outDir, 'quiz.json'), JSON.stringify(quiz, null, 2));

console.log(
  `corpus 条目：${corpus.length}（法条 ${corpus.filter((c) => c.type === 'law').length} / 规则 ${corpus.filter((c) => c.type === 'rule').length} / 风险 ${corpus.filter((c) => c.type === 'risk').length}）`
);
console.log(`quiz 分类：${quiz.length} 个，问题总数：${quiz.reduce((s, c) => s + c.questions.length, 0)}`);
