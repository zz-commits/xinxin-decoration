import { loadCases, loadCatalogue } from '../../services/public-api';
Page({
  data: { services: [], items: [], categoryId: '', loading: true, loadingMore: false, hasMore: false, error: '', localPreview: false },
  page: 0,
  requestVersion: 0,
  onLoad() { this.loadCategories(); this.refresh(); },
  onShow() { const bar = this.getTabBar(); if (bar) bar.setData({ selected: 2 }); },
  async loadCategories() { try { const result = await loadCatalogue(); this.setData({ services: result.data.services }); } catch (_error) { /* 案例列表仍可独立加载。 */ } },
  async onPullDownRefresh() { try { await this.refresh(); } finally { wx.stopPullDownRefresh(); } },
  async refresh() {
    const version = ++this.requestVersion;
    this.page = 0;
    this.setData({ loading: true, loadingMore: false, error: '', items: [], hasMore: false });
    try {
      const result = await loadCases(0, this.data.categoryId);
      if (version !== this.requestVersion) return;
      this.setData({ items: result.data.items, hasMore: result.data.hasMore, localPreview: result.source === 'local' });
    } catch (_error) { if (version === this.requestVersion) this.setData({ error: '案例暂时无法加载，请稍后重试。' }); }
    finally { if (version === this.requestVersion) this.setData({ loading: false }); }
  },
  selectCategory(event: WechatMiniprogram.TouchEvent) {
    this.setData({ categoryId: event.currentTarget.dataset.id || '' }); this.refresh();
  },
  async onReachBottom() {
    if (!this.data.hasMore || this.data.loading || this.data.loadingMore) return;
    const version = this.requestVersion;
    this.setData({ loadingMore: true });
    try {
      const result = await loadCases(this.page + 1, this.data.categoryId);
      if (version !== this.requestVersion) return;
      this.page += 1;
      this.setData({ items: this.data.items.concat(result.data.items), hasMore: result.data.hasMore });
    } catch (_error) { if (version === this.requestVersion) wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' }); }
    finally { if (version === this.requestVersion) this.setData({ loadingMore: false }); }
  },
  openCase(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: '/pages/case-detail/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) }); },
  openContact() { wx.switchTab({ url: '/pages/contact/index' }); },
  onShareAppMessage() { return { title: '鑫新装饰｜定制安装实景案例', path: '/pages/cases/index' }; },
});
