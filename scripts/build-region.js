/**
 * 提取全国最低工资标准 → data/region.json
 *
 * 说明：最低工资数值属客观政策数据（来源：人社部全国表 + 各省人社厅文件），
 * 沿用既有已核验口径；判定与切换逻辑在网页版 src/region.js 中重新实现。
 */
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/Administrator/WorkBuddy/Claw/labor-system-miniprogram/miniprogram/data';
const regionMod = require(path.join(SRC, 'region.js'));

const REGION = regionMod.REGION || {};
const SOURCES = regionMod.SOURCES || {};

const out = {
  updated: '2026-09-09',
  note: '月最低工资标准（元）。tiers 为当前档位，pending 为已公布未生效的新标准（到生效日自动切换）。',
  sources: SOURCES,
  regions: REGION,
};

const outDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'region.json'), JSON.stringify(out, null, 2));

const names = Object.keys(REGION);
console.log(`region.json 已生成：${names.length} 个地区`);
console.log('示例（宁夏）：', JSON.stringify(REGION['宁夏']));
console.log('带待生效标准的地区：', names.filter((n) => REGION[n].pending).join('、'));
