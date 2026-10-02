/**
 * 极简 xlsx 读写（零第三方依赖）
 *
 * 为什么自己写：本项目坚持零依赖，Excel/WPS 用的 .xlsx 本质是 zip + XML，
 * 用 Node 内置 zlib + 手写 zip 结构即可完成，不必引入几十 MB 的库。
 *
 * 导出：inlineStr 方式写单元格（避免维护 sharedStrings）
 * 导入：识别 sharedStrings / inlineStr / 数字 三种单元格写法
 */
const zlib = require('zlib');

/* ---------- CRC32 ---------- */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/* ---------- zip 写入 ---------- */
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  files.forEach((f) => {
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const comp = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const nameBuf = Buffer.from(f.name, 'utf8');

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);      // deflate
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += 30 + nameBuf.length + comp.length;
  });

  const cdStart = offset;
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...central, eocd]);
}

/* ---------- zip 读取 ---------- */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx / zip 文件');

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const out = {};

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8');

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.slice(start, start + compSize);
    out[name] = method === 0 ? comp : zlib.inflateRawSync(comp);

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* ---------- XML 工具 ---------- */
function escXml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[c]);
}
function unescXml(s) {
  return String(s || '')
    // 数字字符引用：某些工具（如 openpyxl 保存的文件）会把中文写成 &#22995; 形式
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
function colName(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function colIndex(ref) {
  const m = String(ref || '').match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* ---------- 导出 ---------- */
/**
 * @param {Array<{name:string, rows:Array<Array>}>} sheets
 * @returns {Buffer} xlsx 文件
 */
function buildXlsx(sheets) {
  const files = [];

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map((s, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ).join('') +
    '</Types>';
  files.push({ name: '[Content_Types].xml', data: contentTypes });

  files.push({
    name: '_rels/.rels',
    data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  });

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    sheets.map((s, i) =>
      `<sheet name="${escXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    ).join('') +
    '</sheets></workbook>';
  files.push({ name: 'xl/workbook.xml', data: workbook });

  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((s, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      ).join('') +
      '</Relationships>',
  });

  sheets.forEach((s, si) => {
    const rowsXml = (s.rows || []).map((row, ri) => {
      const cells = (row || []).map((v, ci) => {
        const ref = colName(ci) + (ri + 1);
        if (v === null || v === undefined || v === '') return `<c r="${ref}"/>`;
        if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');

    files.push({
      name: `xl/worksheets/sheet${si + 1}.xml`,
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        `<sheetData>${rowsXml}</sheetData></worksheet>`,
    });
  });

  return zip(files);
}

/* ---------- 导入 ---------- */
/** 解析 sharedStrings.xml */
function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    const texts = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    out.push(unescXml(texts.map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  }
  return out;
}

/** 解析 sheet.xml → 二维数组 */
function parseSheet(xml, shared) {
  if (!xml) return [];
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1] || cm[3] || '';
      const body = cm[2] || '';
      const refM = attrs.match(/r="([A-Z]+)(\d+)"/);
      const ci = refM ? colIndex(refM[1]) : cells.length;
      const typeM = attrs.match(/t="([^"]+)"/);
      const type = typeM ? typeM[1] : '';

      let val = '';
      if (type === 'inlineStr') {
        const t = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        val = t ? unescXml(t[1]) : '';
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        if (v) {
          val = type === 's' ? shared[Number(v[1])] || '' : unescXml(v[1]);
        }
      }
      while (cells.length < ci) cells.push('');
      cells[ci] = val;
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * 解析 xlsx
 * @returns {Array<{name:string, rows:Array<Array>}>}
 */
function parseXlsx(buf) {
  const files = unzip(buf);
  const shared = parseSharedStrings(files['xl/sharedStrings.xml']);

  // sheet 名 → 文件名：优先读 workbook.xml.rels + workbook.xml 的顺序
  const wb = (files['xl/workbook.xml'] || '').toString('utf8');
  const sheetNames = [];
  const sRe = /<sheet[^>]*name="([^"]*)"[^>]*r:id="(rId\d+)"/g;
  const rels = (files['xl/_rels/workbook.xml.rels'] || '').toString('utf8');
  let sm;
  while ((sm = sRe.exec(wb))) {
    const rid = sm[2];
    const targetM = rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`)) ||
      rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`));
    // 目标路径可能是 "xl/worksheets/sheet1.xml" 也可能是 "/xl/worksheets/sheet1.xml"
    let target = (targetM ? targetM[1] : '').replace(/^\//, '');
    if (target && !target.startsWith('xl/')) target = 'xl/' + target;
    sheetNames.push({ name: sm[1], file: target });
  }

  // 兜底：直接按 sheet1..sheetN 顺序
  if (!sheetNames.length) {
    Object.keys(files)
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
      .sort()
      .forEach((k, i) => sheetNames.push({ name: `Sheet${i + 1}`, file: k }));
  }

  return sheetNames
    .filter((s) => files[s.file])
    .map((s) => ({ name: s.name, rows: parseSheet(files[s.file].toString('utf8'), shared) }));
}

/* ---------- CSV ---------- */
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
    const c = t[i];
    if (inQ) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

module.exports = { buildXlsx, parseXlsx, rowsToCsv, csvToRows, zip, unzip };
