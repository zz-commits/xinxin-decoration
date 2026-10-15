const cloud = require('wx-server-sdk');
const { createHandler } = require('./content');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const handle = createHandler(cloud.database());

async function resolveImages(data) {
  const ids = new Set();
  const collect = value => {
    if (typeof value === 'string' && /^cloud:\/\/[^/]+\/public\//.test(value)) ids.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(data);
  const urls = new Map();
  const list = [...ids];
  for (let i = 0; i < list.length; i += 50) {
    const response = await cloud.getTempFileURL({ fileList: list.slice(i, i + 50) });
    for (const row of response.fileList || []) if (row.tempFileURL) urls.set(row.fileID, row.tempFileURL);
  }
  const replace = value => {
    if (typeof value === 'string' && ids.has(value)) return urls.get(value) || '';
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    return value;
  };
  return replace(data);
}

exports.main = async event => {
  const { APPID, OPENID } = cloud.getWXContext();
  if (APPID !== 'wx4d0fe4f65e530325' || !OPENID) return { ok: false, code: 'UNAUTHORIZED', message: '请从鑫新装饰小程序访问。' };
  try { const result = await handle(event); if (result.ok) result.data = await resolveImages(result.data); return result; }
  catch (_error) { return { ok: false, code: 'CONTENT_UNAVAILABLE', message: '店铺资料暂时无法加载，请稍后重试。' }; }
};
