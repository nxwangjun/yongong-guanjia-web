/* 临时：xlsx 模块自测（跑完可删） */
const fs = require('fs');
const path = require('path');
const { buildXlsx, parseXlsx, rowsToCsv, csvToRows } = require('../src/xlsx');

const sheets = [
  { name: '员工', rows: [['姓名', '部门', '工号'], ['张三', '工程部', 'G001'], ['李四', '综合部', 'Z001']] },
  { name: '薪资', rows: [['姓名', '金额', '加班费'], ['张三', 6000, 500], ['李四', 5200, 0]] },
];

const buf = buildXlsx(sheets);
console.log('生成字节数:', buf.length);

const back = parseXlsx(buf);
console.log('解析回 sheet 数:', back.length);
back.forEach((s) => {
  console.log(`  [${s.name}]`, JSON.stringify(s.rows));
});

// 校验往返一致
let ok = true;
back.forEach((s, i) => {
  const want = sheets[i].rows;
  const got = s.rows;
  for (let r = 0; r < want.length; r++) {
    for (let c = 0; c < want[r].length; c++) {
      const w = String(want[r][c]);
      const g = String((got[r] && got[r][c]) ?? '');
      if (w !== g) {
        ok = false;
        console.log(`  ❌ ${s.name} 第${r + 1}行第${c + 1}列：期望「${w}」实际「${g}」`);
      }
    }
  }
});
console.log(ok ? '✅ xlsx 往返一致' : '❌ xlsx 往返不一致');

// CSV 往返
const csv = rowsToCsv(sheets[0].rows);
const csvBack = csvToRows(csv);
console.log('CSV 往返:', JSON.stringify(csvBack) === JSON.stringify(sheets[0].rows) ? '✅' : '❌ ' + JSON.stringify(csvBack));
