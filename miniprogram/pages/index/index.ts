import { contactStore, loadCases, loadCatalogue } from '../../services/public-api';

Page({
  data: { store: null, services: [], cases: [], loading: true, error: '', localPreview: false },
  onLoad() { this.refresh(); },
  onShow() { const bar = this.getTabBar(); if (bar) bar.setData({ selected: 0 }); },
  async onPullDownRefresh() { try { await this.refresh(); } finally { wx.stopPullDownRefresh(); } },

  async refresh() {
    this.setData({ loading: true, error: '' });
    try {
      const [catalogue, cases] = await Promise.all([loadCatalogue(), loadCases()]);
      this.setData({
        store: catalogue.data.store,
        services: catalogue.data.services,
        cases: cases.data.items.slice(0, 2),
        localPreview: catalogue.source === 'local' || cases.source === 'local',
      });
    } catch (_error) {
      this.setData({ error: '内容暂时无法加载，请稍后重试。' });
    } finally { this.setData({ loading: false }); }
  },

  openService(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: '/pages/service-detail/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) });
  },
  openCase(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: '/pages/case-detail/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) });
  },
  openCases() { wx.switchTab({ url: '/pages/cases/index' }); },
  openServices() { wx.switchTab({ url: '/pages/services/index' }); },
  openContact() { wx.switchTab({ url: '/pages/contact/index' }); },
  async call() { try { if (this.data.store) await contactStore(this.data.store.phones); } catch (_error) { /* 用户取消拨号。 */ } },
  onShareAppMessage() { return { title: '鑫新装饰｜不锈钢、门窗与金属制品定制', path: '/pages/index/index' }; },
});
