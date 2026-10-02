/* 前端接口封装 */
const API = (() => {
  async function req(method, path, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    const r = await fetch(path, opt);
    const t = await r.text();
    let j;
    try {
      j = JSON.parse(t);
    } catch (e) {
      throw new Error('返回不是 JSON：' + t.slice(0, 120));
    }
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }

  return {
    get: (p) => req('GET', p),
    post: (p, b) => req('POST', p, b),
    put: (p, b) => req('PUT', p, b),
    del: (p) => req('DELETE', p),

    // 通用集合
    list: (col, filter = {}) => {
      const qs = Object.keys(filter).map((k) => `${k}=${encodeURIComponent(filter[k])}`).join('&');
      return req('GET', `/api/c/${col}${qs ? '?' + qs : ''}`).then((d) => d.items || []);
    },
    add: (col, obj) => req('POST', `/api/c/${col}`, obj),
    update: (col, id, patch) => req('PUT', `/api/c/${col}/${id}`, patch),
    remove: (col, id) => req('DELETE', `/api/c/${col}/${id}`),

    // 业务
    health: () => req('GET', '/api/health'),
    stats: () => req('GET', '/api/stats'),
    scan: () => req('GET', '/api/scan'),
    quiz: () => req('GET', '/api/quiz'),
    rules: () => req('GET', '/api/rules'),
    setRule: (id, enabled) => req('PUT', `/api/rules/${id}`, { enabled }),
    confirm: (ruleId, answer, note) => req('POST', '/api/confirm', { ruleId, answer, note }),
    survey: (answers) => req('POST', '/api/survey', { answers }),
    dispatch: (payload) => req('POST', '/api/dispatch', payload),
    explain: (item) => req('POST', '/api/ai/explain', { item }),
    chat: (question, history) => req('POST', '/api/ai/chat', { question, history }),
    diagnose: (meta, answers) => req('POST', '/api/diagnose', { meta, answers }),
    settings: () => req('GET', '/api/settings'),
    saveSettings: (obj) => req('PUT', '/api/settings', obj),
    configKey: (o) => req('POST', '/api/config-key', o),
    exportAll: () => req('GET', '/api/export'),
    importAll: (data) => req('POST', '/api/import', data),
    reset: () => req('POST', '/api/reset', {}),
  };
})();
