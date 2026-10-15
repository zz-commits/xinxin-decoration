const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const { APPID, OPENID } = cloud.getWXContext();

  if (APPID !== 'wx4d0fe4f65e530325' || !OPENID) {
    return {
      ok: false,
      code: 'WX_IDENTITY_REQUIRED',
      message: '请从鑫新装饰小程序调用检查函数。',
    };
  }

  return {
    ok: true,
    data: {
      service: 'xinxin-cloudbase',
      appId: APPID,
      hasIdentity: true,
      checkedAt: new Date().toISOString(),
    },
  };
};
