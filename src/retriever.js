/**
 * 轻量 BM25 检索器（零依赖）
 * 中文按「单字 + 二元组」切分，英文按单词切分，足以支撑劳动法领域的垂直检索。
 * 语料规模仅数百条，内存建索引即可，无需向量数据库。
 */

function tokenize(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  const tokens = [];
  const en = lower.match(/[a-z0-9]+/g);
  if (en) tokens.push(...en);
  const cjk = lower.match(/[一-鿿]/g) || [];
  for (let i = 0; i < cjk.length; i++) {
    tokens.push(cjk[i]);
    if (i + 1 < cjk.length) tokens.push(cjk[i] + cjk[i + 1]);
  }
  return tokens;
}

class Retriever {
  constructor(docs) {
    this.docs = docs || [];
    this.k1 = 1.5;
    this.b = 0.75;
    this._build();
  }

  _build() {
    this.tf = [];
    this.docLen = [];
    this.df = {};
    this.avgdl = 0;
    this.N = this.docs.length;
    this.docs.forEach((doc) => {
      const toks = tokenize(`${doc.title || ''} ${doc.text || ''}`);
      const tf = {};
      toks.forEach((t) => (tf[t] = (tf[t] || 0) + 1));
      this.tf.push(tf);
      this.docLen.push(toks.length);
      this.avgdl += toks.length;
      Object.keys(tf).forEach((t) => (this.df[t] = (this.df[t] || 0) + 1));
    });
    this.avgdl = this.N ? this.avgdl / this.N : 0;
  }

  /**
   * 检索
   * @param {string} query 查询文本
   * @param {number} topK 召回数量
   * @param {{types?:string[], boostTags?:string[]}} opts 过滤/加权
   */
  search(query, topK = 6, opts = {}) {
    const qToks = tokenize(query);
    if (!qToks.length || !this.N) return [];
    const { types, boostTags } = opts;
    const scored = [];
    for (let i = 0; i < this.N; i++) {
      const tf = this.tf[i];
      const dl = this.docLen[i];
      let score = 0;
      for (const t of qToks) {
        if (!(t in this.df)) continue;
        const f = tf[t] || 0;
        if (!f) continue;
        const idf = Math.log(1 + (this.N - this.df[t] + 0.5) / (this.df[t] + 0.5));
        score +=
          idf *
          ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * (dl / (this.avgdl || 1)))));
      }
      if (score <= 0) continue;
      const doc = this.docs[i];
      if (types && !types.includes(doc.type)) continue;
      // 标签命中加权（如诊断时按风险分类过滤）
      if (boostTags && boostTags.length) {
        const hit = (doc.tags || []).some((tag) => boostTags.includes(tag));
        if (hit) score *= 1.8;
      }
      scored.push({ doc, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => ({ ...s.doc, score: Number(s.score.toFixed(4)) }));
  }

  /** 多查询去重召回（用于诊断：把多个风险点拼成多条查询） */
  searchMany(queries, topK = 6, opts = {}) {
    const seen = new Map();
    for (const q of queries) {
      for (const d of this.search(q, topK, opts)) {
        if (!seen.has(d.id) || seen.get(d.id).score < d.score) seen.set(d.id, d);
      }
    }
    return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, topK * 2);
  }
}

module.exports = { Retriever, tokenize };
