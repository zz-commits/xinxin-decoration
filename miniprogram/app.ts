import { cloudConfig } from './config/cloud';

App({
  globalData: {
    cloudReady: false,
    cloudError: '',
  },

  onLaunch() {
    if (!cloudConfig.envId.trim()) return;

    if (!wx.cloud) {
      this.globalData.cloudError = '当前基础库不支持云开发，请更新微信开发者工具和调试基础库。';
      return;
    }

    try {
      wx.cloud.init({ env: cloudConfig.envId.trim() });
      this.globalData.cloudReady = true;
    } catch (_error) {
      this.globalData.cloudError = '云开发初始化失败，请检查环境 ID 和小程序关联。';
    }
  },
});
