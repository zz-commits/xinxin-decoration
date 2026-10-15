import { cloudConfig } from '../config/cloud';

export async function engineerRequest<T = any>(action: string, payload = {}): Promise<T> {
  if (!getApp().globalData.cloudReady) throw new Error('云开发尚未初始化，请检查环境配置。');
  const response = await wx.cloud.callFunction({ name: 'engineer-api', data: { action, payload }, config: { env: cloudConfig.envId } });
  const result = response.result as { ok?: boolean; data: T; message?: string };
  if (!result || !result.ok) throw new Error(result && result.message || '工作台请求失败，请确认云函数已部署。');
  return result.data;
}

export function showError(error: unknown) {
  wx.showModal({ title: '操作未完成', content: error instanceof Error ? error.message : '请稍后重试。', showCancel: false });
}
