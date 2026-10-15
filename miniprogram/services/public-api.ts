import { cloudConfig } from '../config/cloud';
import type { CaseItem, Catalogue, ContentResult } from '../models/content';
import { catalogue as localCatalogue } from '../data/catalogue';

export function isDevelopment(): boolean {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion !== 'release';
  } catch (_error) {
    return false;
  }
}

async function request<T>(action: string, payload = {}): Promise<T> {
  const app = getApp();
  if (!app.globalData.cloudReady) throw new Error('云开发尚未连接');
  const response = await wx.cloud.callFunction({
    name: 'public-api',
    data: { action, payload },
    config: { env: cloudConfig.envId },
  });
  const result = response.result as { ok: boolean; data: T; message?: string };
  if (!result || !result.ok) throw new Error(result && result.message || '内容暂时无法加载');
  return result.data;
}

export async function loadCatalogue(): Promise<ContentResult<Catalogue>> {
  try {
    return { data: await request<Catalogue>('getCatalogue'), source: 'cloud' };
  } catch (error) {
    if (!isDevelopment()) throw error;
    return { data: localCatalogue, source: 'local' };
  }
}

export async function loadCases(page = 0, categoryId = ''): Promise<ContentResult<{ items: CaseItem[]; hasMore: boolean }>> {
  try {
    const data = await request<{ items: CaseItem[]; hasMore: boolean }>('listCases', { page, categoryId });
    return { data, source: 'cloud' };
  } catch (error) {
    if (!isDevelopment()) throw error;
    return { data: { items: [], hasMore: false }, source: 'local' };
  }
}

export async function loadCase(id: string): Promise<CaseItem | null> {
  return request<CaseItem | null>('getCase', { id });
}

export async function contactStore(phones: string[]): Promise<void> {
  if (!phones.length) {
    wx.showToast({ title: '联系电话待补充', icon: 'none' });
    return;
  }
  if (phones.length === 1) {
    await wx.makePhoneCall({ phoneNumber: phones[0] });
    return;
  }
  const result = await wx.showActionSheet({ itemList: phones.map(phone => '拨打 ' + phone) });
  await wx.makePhoneCall({ phoneNumber: phones[result.tapIndex] });
}
