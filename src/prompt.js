/**
 * 提示词模板（中文 · 劳动法合规方向）
 * 设计原则：RAG 优先——所有法律结论必须基于下方【检索到的依据】，
 * 不编造法条；结论先行 + 结构化；附免责声明（非正式法律意见）。
 */

const DISCLAIMER =
  '⚠️ 本结论由 AI 基于既有劳动法知识库检索生成，仅供初步自查与学习参考，不构成正式法律意见，亦不替代律师当面咨询与阅卷。';

const DIAGNOSIS_SYSTEM = `你是一名资深劳动法律师助理，服务于企业用工合规场景。
你的任务是：根据企业填写的「用工自检答卷」和下方【检索到的法律依据】，生成一份结构化的用工合规风险诊断报告。

硬性要求：
1. 只依据【检索到的法律依据】中的条文作答，严禁编造法条、案号或数据。
2. 结论先行：先用 2-3 句话概括整体风险态势。
3. 风险点按严重程度（高/中/低）排序，每条包含：风险描述、法律依据（引用具体法条）、可能的法律后果、整改建议。
4. 用语通俗，避免堆砌专业术语；对必要的法律术语做一句白话解释。
5. 最后给出 3 条最优先的整改行动建议。
6. 报告末尾附免责声明。

请严格输出如下 JSON（不要包含任何额外说明文字、不要使用 Markdown 代码块包裹）：
{
  "summary": "整体风险概括（结论先行）",
  "counts": { "high": 0, "mid": 0, "low": 0, "total": 0 },
  "items": [
    {
      "severity": "高|中|低",
      "category": "风险所属环节",
      "risk": "风险描述",
      "law": "引用的法律依据（具体法条）",
      "consequence": "可能的法律后果",
      "remedy": "整改建议",
      "articles": ["相关法条正文摘录"]
    }
  ],
  "advice": "3 条最优先整改行动（用换行分隔）"
}`;

const CHAT_SYSTEM = `你是一名专业的劳动法咨询助手，服务于企业与劳动者。
请仅依据下方【检索到的法律依据】回答用户问题：
1. 如果【检索到的法律依据】能够回答，请引用具体法条并给出通俗解释与可操作建议。
2. 如果依据不足以回答，请明确说明"现有知识库未覆盖该问题，建议咨询专业律师"，不要编造。
3. 回答简洁实用，必要时分点；必要的法律术语用一句白话解释。
4. 不涉及政治、不提供超越法律咨询的承诺。
${DISCLAIMER}`;

function buildDiagnosisUser(profile, docs) {
  const meta = profile.meta || {};
  const metaLine = [
    meta.companySize ? `企业规模：${meta.companySize}` : '',
    meta.industry ? `行业：${meta.industry}` : '',
    meta.region ? `地区：${meta.region}` : '',
  ]
    .filter(Boolean)
    .join('；');

  const answers = profile.answers || {};
  const answered = Object.keys(answers).map((id) => {
    const q = (profile.quizIndex && profile.quizIndex[id]) || null;
    return `- [${id}] 问题：${q ? q.q : id}；回答：${answers[id]}（${answers[id] === 'no' ? '未做到/存在风险' : answers[id] === 'unsure' ? '不确定/待核实' : '已做到/合规'})${q ? '；该环节风险点：' + q.risk : ''}`;
  });

  const ctx = docs
    .map((d, i) => `【依据${i + 1}】(${d.type}/${d.source}) ${d.title}\n${d.text}`)
    .join('\n\n');

  return `企业信息：${metaLine || '未填写'}

自检答卷（回答 no=未做到/有风险，unsure=不确定，yes=已做到）：
${answered.join('\n') || '（未作答）'}

========== 检索到的法律依据 ==========
${ctx}

请基于上述答卷与依据，输出诊断报告 JSON。`;
}

function buildChatUser(question, docs, history) {
  const ctx = docs
    .map((d, i) => `【依据${i + 1}】(${d.type}/${d.source}) ${d.title}\n${d.text}`)
    .join('\n\n');
  const hist = (history || [])
    .slice(-6)
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
    .join('\n');
  return `对话历史：
${hist || '（无）'}

========== 检索到的法律依据 ==========
${ctx}

用户问题：${question}

请基于依据回答。`;
}

module.exports = { DIAGNOSIS_SYSTEM, CHAT_SYSTEM, DISCLAIMER, buildDiagnosisUser, buildChatUser };
