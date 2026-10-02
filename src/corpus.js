/**
 * 语料加载：corpus.json（可被检索的法条/规则/风险点）+ quiz.json（自检问卷）
 * 由 scripts/build-corpus.js 从「用工管家」既有知识库生成。
 */
const fs = require('fs');
const path = require('path');

function loadJson(name) {
  const p = path.join(__dirname, '..', 'data', name);
  if (!fs.existsSync(p)) {
    throw new Error(`缺少 ${name}，请先运行：npm run corpus`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const corpus = loadJson('corpus.json');
const quiz = loadJson('quiz.json');

// 建立 quiz 问题的快速索引（按 id 查详情）
const quizIndex = {};
quiz.forEach((c) =>
  c.questions.forEach((q) => {
    quizIndex[q.id] = { ...q, category: c.key, categoryLabel: c.label };
  })
);

module.exports = { corpus, quiz, quizIndex };
