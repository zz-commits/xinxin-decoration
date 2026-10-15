const cloud = require('wx-server-sdk');
const { createHandler } = require('./domain');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const handle = createHandler(cloud, cloud.database());
const businessCodes = new Set(['UNAUTHORIZED', 'ENGINEER_REQUIRED', 'INVALID_ARGUMENT', 'PROJECT_NOT_FOUND', 'LOCATION_NOT_FOUND', 'LIMIT_REACHED', 'ASSET_NOT_READY', 'INVALID_IMAGE', 'INCOMPLETE_REQUIREMENTS', 'GENERATION_IN_PROGRESS', 'CONFIRMATION_REQUIRED', 'STALE_PREVIEW', 'REVIEW_REQUIRED', 'INVALID_PROJECT_STATE', 'RETRY_LIMIT', 'SHARE_NOT_FOUND', 'INVALID_ACTION']);
exports.main = async event => {
  try { return { ok: true, data: await handle(event, cloud.getWXContext()) }; }
  catch (error) {
    if (businessCodes.has(error.code)) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: 'SERVICE_UNAVAILABLE', message: '工作台暂不可用，请确认数据库集合、索引及权限已配置。' };
  }
};
