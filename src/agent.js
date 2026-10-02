/**
 * 智能体核心：检索增强（RAG）+ 大模型诊断/问答
 *
 * 设计：
 *  - 优先调用真实大模型（OpenAI 兼容协议，默认 DeepSeek），传入 RAG 检索到的法条作为依据；
 *  - 未配置 Key 或调用失败时，自动降级为「本地规则引擎」：仍基于同一份检索语料做结构化合成，
 *    保证裁判/演示在任何环境都能跑通，且明确标注并非 AI。
 *
 * 绝不"伪造 AI"：LLM 路径是真实 HTTP 调用；降级路径在返回中标注 mode:'local'。
 */
const config = require('./config');
const fs = require('fs');
const path = require('path');
const { Retriever } = require('./retriever');
const { corpus, quizIndex } = require('./corpus');
const {
  DIAGNOSIS_SYSTEM,
  CHAT_SYSTEM,
  DISCLAIMER,
  buildDiagnosisUser,
  buildChatUser,
} = require('./prompt');

const retriever = new Retriever(corpus);

/** 真实大模型调用（OpenAI 兼容 /chat/completions） */
async function callLLM(messages) {
  if (!config.LLM_ENABLED) return null;
  const url = config.LLM_BASE_URL.replace(/\/+$/, '') + '/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + config.LLM_API_KEY,
      },
      body: JSON.stringify({
        model: config.LLM_MODEL,
        messages,
        temperature: 0.3,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error('LLM HTTP ' + resp.status);
    const data = await resp.json();
    return (data.choices && data.choices[0] && data.choices[0].message.content) || '';
  } finally {
    clearTimeout(timer);
  }
}

function parseJSON(text) {
  if (!text) return null;
  let t = String(text).trim();
  // 去掉可能存在的 ```json ... ``` 包裹
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  // 截取首个 { 到末尾最后一个 }
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  try {
    return JSON.parse(t);
  } catch (e) {
    return null;
  }
}

/**
 * 诊断主入口
 * @param {{meta?:object, answers:object}} profile
 */
async function diagnose(profile) {
  const answers = profile.answers || {};
  const ids = Object.keys(answers);
  // 风险点：回答为 no / unsure 的题
  const risky = ids.filter((id) => answers[id] === 'no' || answers[id] === 'unsure');

  // 构造检索查询：用风险点的"风险描述 + 自查问题"
  const queries = risky.map((id) => {
    const q = quizIndex[id];
    return q ? `${q.risk} ${q.q}` : id;
  });
  // 若未作答也至少检索整体，避免空结果
  if (!queries.length) queries.push('企业用工合规 劳动合同 工资 社保 解除');
  const docs = retriever.searchMany(queries, config.TOP_K, {});

  const userMsg = buildDiagnosisUser(
    { ...profile, quizIndex },
    docs
  );

  let llmRaw = null;
  try {
    llmRaw = await callLLM([
      { role: 'system', content: DIAGNOSIS_SYSTEM },
      { role: 'user', content: userMsg },
    ]);
  } catch (e) {
    llmRaw = null;
  }

  const parsed = llmRaw ? parseJSON(llmRaw) : null;
  if (parsed && Array.isArray(parsed.items)) {
    return {
      mode: 'llm',
      model: config.LLM_MODEL,
      ...parsed,
      disclaimer: DISCLAIMER,
    };
  }
  // 降级：本地规则引擎
  return localDiagnose(profile, risky, docs);
}

/** 本地规则引擎（无 LLM 时的兜底，仍基于同一语料检索） */
function localDiagnose(profile, risky, docs) {
  const answers = profile.answers || {};
  const meta = profile.meta || {};
  const items = risky.map((id) => {
    const q = quizIndex[id];
    // 为该风险点补充检索到的法条正文
    const arts = retriever
      .search(`${q ? q.risk : id} ${q ? q.law : ''}`, 2, { types: ['law', 'rule'] })
      .map((d) => (d.type === 'law' ? `${d.title}：${d.text}` : d.text))
      .slice(0, 2);
    return {
      severity: q && q.sev === '高' ? '高' : q && q.sev === '中' ? '中' : '低',
      category: q ? q.categoryLabel : '其他',
      risk: q ? q.risk : id,
      law: q ? q.law : '',
      consequence: q ? q.consequence : '',
      remedy: q ? q.remedy : '',
      articles: arts,
    };
  });

  const order = { 高: 0, 中: 1, 低: 2 };
  items.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

  const counts = {
    high: items.filter((i) => i.severity === '高').length,
    mid: items.filter((i) => i.severity === '中').length,
    low: items.filter((i) => i.severity === '低').length,
    total: items.length,
  };

  const summary =
    counts.total === 0
      ? '根据本次自检，未发现明显违规风险点，用工合规状况良好。仍建议定期复盘以下环节并保持证据留存。'
      : `本次自检共识别 ${counts.total} 个需关注的用工风险点（高 ${counts.high} / 中 ${counts.mid} / 低 ${counts.low}）。建议优先处理高危项，避免行政处罚与劳动争议敞口。`;

  const advice = [
    counts.high > 0 ? '立即整改全部"高"危风险点（如童工、扣押证件、未签书面合同等），并留存整改证据。' : '保持现有合规动作，建立月度自查机制。',
    '对"中/低"风险点制定整改时间表，指定归口负责人。',
    '重要用工决策（解除、调岗、加班费核算）前，调取对应法条与书面依据。',
  ].join('\n');

  return {
    mode: 'local',
    model: '本地规则引擎（未配置大模型密钥，已自动降级）',
    summary,
    counts,
    items,
    advice,
    disclaimer: DISCLAIMER,
  };
}

/**
 * 自由问答主入口
 * @param {{question:string, history?:Array, profile?:object}} param
 */
async function chat({ question, history = [], profile = null }) {
  const docs = retriever.search(question, config.TOP_K, {});
  const userMsg = buildChatUser(question, docs, history);

  let llmRaw = null;
  try {
    llmRaw = await callLLM([
      { role: 'system', content: CHAT_SYSTEM },
      { role: 'user', content: userMsg },
    ]);
  } catch (e) {
    llmRaw = null;
  }

  if (llmRaw && llmRaw.trim()) {
    return {
      mode: 'llm',
      model: config.LLM_MODEL,
      answer: llmRaw.trim(),
      citations: docs.map((d) => ({ ref: d.title, source: d.source })),
    };
  }
  return localChat(question, docs);
}

/** 本地规则引擎问答兜底 */
function localChat(question, docs) {
  if (!docs.length) {
    return {
      mode: 'local',
      model: '本地规则引擎（未配置大模型密钥，已自动降级）',
      answer:
        '现有知识库未覆盖该问题，建议咨询专业劳动法律师获取针对性意见。' + DISCLAIMER,
      citations: [],
    };
  }
  const parts = docs.slice(0, 3).map((d, i) => `（依据${i + 1}）${d.title}\n${d.text}`);
  return {
    mode: 'local',
    model: '本地规则引擎（未配置大模型密钥，已自动降级）',
    answer:
      '根据检索到的劳动法依据，整理如下：\n\n' +
      parts.join('\n\n') +
      '\n\n（以上为本地规则引擎基于知识库的检索结果，配置大模型密钥后将获得更自然的 AI 解读。）\n' +
      DISCLAIMER,
    citations: docs.map((d) => ({ ref: d.title, source: d.source })),
  };
}

/** 运行时更换大模型密钥（页面「系统设置」粘贴后立即生效，并写入 .env 持久化） */
function setRuntimeKey({ apiKey, baseUrl, model }) {
  if (baseUrl) config.LLM_BASE_URL = baseUrl;
  if (model) config.LLM_MODEL = model;
  config.LLM_API_KEY = apiKey || '';
  config.LLM_ENABLED = config.LLM_API_KEY.trim().length > 0;

  try {
    const envPath = path.join(__dirname, '..', '.env');
    let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const setLine = (t, k, v) => {
      const re = new RegExp('^' + k + '=.*$', 'm');
      return re.test(t) ? t.replace(re, `${k}=${v}`) : t.replace(/\s*$/, '') + `\n${k}=${v}\n`;
    };
    text = setLine(text, 'LLM_API_KEY', config.LLM_API_KEY);
    if (baseUrl) text = setLine(text, 'LLM_BASE_URL', baseUrl);
    if (model) text = setLine(text, 'LLM_MODEL', model);
    fs.writeFileSync(envPath, text);
  } catch (e) {
    // 写 .env 失败不影响运行时生效
  }
  return { llmEnabled: config.LLM_ENABLED };
}

/**
 * AI 解读单条风险（把"命中了什么"讲成人话 + 给可执行的整改步骤）
 */
async function explainRisk(item, companyName) {
  const lawText = (item.law || []).map((l) => `${l.ref}：${l.text}`).join('\n');
  const people = (item.people || [])
    .slice(0, 8)
    .map((p) => `${p.name}（${p.dept}）：${p.detail}`)
    .join('\n');
  const query = `${item.risk} ${(item.law || []).map((l) => l.ref).join(' ')}`;
  const docs = retriever.search(query, 4, {});
  const ctx = docs.map((d, i) => `【依据${i + 1}】${d.title}\n${d.text}`).join('\n\n');

  const prompt = `企业：${companyName || '（未填写）'}
风险点：${item.risk}
涉及人员：
${people || '（本条为台账/问卷项，无具体人员明细）'}
已知法律依据：
${lawText || '（未附）'}

补充检索到的依据：
${ctx}

请用通俗语言输出三段：
1）这条风险是什么意思（一句话说清，别堆术语）；
2）不整改会怎么样（结合上面法律后果）；
3）具体怎么改（分步骤，能落地，别写"加强管理"这种空话）。
不要输出评分、等级标签或百分比。`;

  let out = null;
  try {
    out = await callLLM([
      { role: 'system', content: CHAT_SYSTEM },
      { role: 'user', content: prompt },
    ]);
  } catch (e) {
    out = null;
  }

  if (out && out.trim()) {
    return { mode: 'llm', model: config.LLM_MODEL, text: out.trim() };
  }
  const text =
    `【这条风险是什么意思】\n${item.risk || ''}\n\n` +
    `【不整改会怎么样】\n${item.consequence || '（知识库未收录具体后果，建议咨询律师）'}\n\n` +
    `【具体怎么改】\n${(item.remedy && item.remedy.length
      ? item.remedy
      : ['建议咨询专业律师后制定整改方案']
    )
      .map((r, i) => `${i + 1}. ${r}`)
      .join('\n')}\n\n（本地规则引擎输出，配置大模型密钥后将获得更自然的 AI 解读。）`;
  return { mode: 'local', model: '本地规则引擎（未配置大模型密钥）', text };
}

module.exports = { diagnose, chat, explainRisk, setRuntimeKey, retriever, callLLM };
