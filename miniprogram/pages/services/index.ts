import { loadCatalogue } from '../../services/public-api';
Page({
  data: { services: [], loading: true, error: '', localPreview: false },
  onLoad() { this.refresh(); },
  onShow() { const bar = this.getTabBar(); if (bar) bar.setData({ selected: 1 }); },
  async onPullDownRefresh() { try { await this.refresh(); } finally { wx.stopPullDownRefresh(); } },
  async refresh() {
    this.setData({ loading: true, error: '' });
    try { const result = await loadCatalogue(); this.setData({ services: result.data.services, localPreview: result.source === 'local' }); }
    catch (_error) { this.setData({ error: '业务资料暂时无法加载，请稍后重试。' }); }
    finally { this.setData({ loading: false }); }
  },
  openDetail(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: '/pages/service-detail/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) }); },
  openContact() { wx.switchTab({ url: '/pages/contact/index' }); },
  onShareAppMessage() { return { title: '鑫新装饰｜看看我们能为你定制什么', path: '/pages/services/index' }; },
});
