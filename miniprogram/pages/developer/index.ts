import { cloudConfig } from '../../config/cloud';

Page({
  data: {
    envId: cloudConfig.envId.trim(),
    checking: false,
    connected: false,
    statusTitle: '等待配置云开发环境',
    statusDescription: '项目已就绪。请在开发者工具上方打开「云开发」，创建开发环境。',
    checkedAt: '',
  },

  onLoad() {
    const app = getApp();

    if (app.globalData.cloudError) {
      this.setData({
        statusTitle: '需要检查云开发配置',
        statusDescription: app.globalData.cloudError,
      });
    } else if (this.data.envId) {
      this.setData({
        statusTitle: '环境已填写，等待连通性检查',
        statusDescription: '请先上传 healthcheck 云函数，再点击下方按钮。',
      });
    }
  },

  async checkConnection() {
    if (this.data.checking) return;

    const app = getApp();
    if (!this.data.envId || !app.globalData.cloudReady) {
      this.setData({
        connected: false,
        statusTitle: '请先填写环境 ID',
        statusDescription: app.globalData.cloudError || '在 miniprogram/config/cloud.ts 中填写完整环境 ID，然后重新编译。',
      });
      return;
    }

    this.setData({
      checking: true,
      connected: false,
      checkedAt: '',
      statusTitle: '正在连接云函数',
      statusDescription: '正在验证当前小程序到云开发环境的调用链路。',
    });

    try {
      const response = await wx.cloud.callFunction({
        name: 'healthcheck',
        data: {},
        config: { env: this.data.envId },
      });
      const result = response.result as {
        ok?: boolean;
        data?: { hasIdentity?: boolean; checkedAt?: string };
      } | undefined;

      if (!result || result.ok !== true || !result.data || !result.data.hasIdentity) {
        this.setData({
          statusTitle: '微信身份验证未通过',
          statusDescription: '请确认当前项目使用正确的 AppID，并已关联这个云开发环境。',
        });
        return;
      }

      this.setData({
        connected: true,
        statusTitle: '云函数连接成功',
        statusDescription: '小程序调用和微信身份验证通过，可继续配置数据库、存储和业务功能。',
        checkedAt: result.data.checkedAt
          ? '检查时间：' + new Date(result.data.checkedAt).toLocaleString('zh-CN')
          : '',
      });
    } catch (_error) {
      this.setData({
        statusTitle: '暂未连接到云函数',
        statusDescription: '请确认环境 ID、AppID 关联，以及 healthcheck 是否已部署到同一个开发环境。',
      });
    } finally {
      this.setData({ checking: false });
    }
  },
});
