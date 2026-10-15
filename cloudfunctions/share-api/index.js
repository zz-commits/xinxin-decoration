const cloud = require('wx-server-sdk');
const { createHandler } = require('./domain');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const handle = createHandler(cloud, cloud.database());
exports.main = async event => {
  const { APPID, OPENID } = cloud.getWXContext();
  if (APPID !== 'wx4d0fe4f65e530325' || !OPENID) return { ok: false, code: 'UNAUTHORIZED', message: '请从鑫新装饰小程序访问。' };
  try { return { ok: true, data: await handle(event && event.code) }; }
  catch (_error) { return { ok: false, code: 'SHARE_UNAVAILABLE', message: '方案暂时无法加载，请联系工程师。' }; }
};
