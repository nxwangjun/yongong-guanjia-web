/**
 * 构建浏览器端资源包（data-bundle / seed / engine-browser）
 * 用法：node scripts/build-browser.js
 *
 * 产出：
 *   public/js/data-bundle.js     —— 内嵌 rules/region/quiz JSON（浏览器直接可用，无网络请求）
 *   public/js/seed.js            —— 从 src/db.js 的 seed() 提取，返回演示数据深拷贝
 *   public/js/engine-browser.js  —— region.js + engine.js 去 CommonJS 化合并，挂 window.Engine
 *
 * 注意：data/rules.json、data/region.json、data/quiz.json、src/db.js(seed)、
 *       src/engine.js、src/region.js 改动后，必须重跑本脚本。
 *       corpus.json 不内嵌（411KB，RAG 检索留在服务端）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public/js');

/* ================= 1) data-bundle.js ================= */
function embed(name, rel) {
  const obj = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  return `window.${name} = ${JSON.stringify(obj)};`;
}

const bundle = [
  '/* 本文件由 scripts/build-browser.js 自动生成，请勿手改。',
  '   修改 data/rules.json / data/region.json / data/quiz.json 后运行：node scripts/build-browser.js */',
  embed('RULES_DATA', 'data/rules.json'),
  embed('REGION_DATA', 'data/region.json'),
  embed('QUIZ_DATA', 'data/quiz.json'),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'data-bundle.js'), bundle);

/* ================= 2) seed.js ================= */
const dbSrc = fs.readFileSync(path.join(ROOT, 'src/db.js'), 'utf8');
const start = dbSrc.indexOf('function seed()');
if (start < 0) throw new Error('src/db.js 里找不到 function seed()');
const tail = dbSrc.slice(start);
const endM = tail.match(/\n\}\n/);
if (!endM) throw new Error('无法定位 seed() 函数结尾');
const seedFn = tail.slice(0, endM.index + 3);

const emptyM = dbSrc.match(/const EMPTY = \{[\s\S]*?\n\};/);
if (!emptyM) throw new Error('src/db.js 里找不到 const EMPTY');

const seedOut = [
  '/* 本文件由 scripts/build-browser.js 自动生成，请勿手改。',
  '   来源：src/db.js 的 seed()（36 人演示数据，17 类预埋风险）。',
  '   修改种子数据请改 src/db.js 的 seed()，然后重跑 build-browser.js。 */',
  emptyM[0],
  '',
  seedFn,
  '',
  '/** 返回一份演示数据深拷贝（浏览器端专用） */',
  'window.getSeed = function getSeed() {',
  '  return JSON.parse(JSON.stringify(seed()));',
  '};',
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'seed.js'), seedOut);

/* ================= 3) engine-browser.js ================= */
let regionSrc = fs.readFileSync(path.join(ROOT, 'src/region.js'), 'utf8');
regionSrc = regionSrc.replace("const DATA = require('../data/region.json');", 'const DATA = window.REGION_DATA;');
const regionExports = regionSrc.match(/module\.exports = \{([\s\S]*?)\};/);
if (!regionExports) throw new Error('region.js 缺少 module.exports');
regionSrc = regionSrc.replace(/module\.exports = \{[\s\S]*?\};/, `const Region = {${regionExports[1]}};`);

let engineSrc = fs.readFileSync(path.join(ROOT, 'src/engine.js'), 'utf8');
engineSrc = engineSrc.replace("const RULES = require('../data/rules.json');", 'const RULES = window.RULES_DATA;');
if (!/module\.exports = \{ scan, probationLimit, RULES, EXTRA_RULE_LIST \};/.test(engineSrc)) {
  throw new Error('engine.js 的 module.exports 行变了，请更新 build 脚本');
}
engineSrc = engineSrc.replace('module.exports = { scan, probationLimit, RULES, EXTRA_RULE_LIST };', '');

const engineOut = [
  '/* 本文件由 scripts/build-browser.js 自动生成，请勿手改。',
  '   来源：src/region.js + src/engine.js（去 CommonJS 化，挂 window.Engine）。',
  '   修改引擎逻辑请改 src/engine.js / src/region.js，然后重跑 build-browser.js。 */',
  'window.Engine = (() => {',
  '  "use strict";',
  regionSrc.split('\n').map((l) => '  ' + l).join('\n'),
  '',
  engineSrc.split('\n').map((l) => '  ' + l).join('\n'),
  '',
  '  return { scan, probationLimit, RULES, EXTRA_RULE_LIST, Region };',
  '})();',
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'engine-browser.js'), engineOut);

for (const f of ['data-bundle.js', 'seed.js', 'engine-browser.js']) {
  console.log('OK ', f.padEnd(20), fs.statSync(path.join(OUT, f)).size, 'bytes');
}
