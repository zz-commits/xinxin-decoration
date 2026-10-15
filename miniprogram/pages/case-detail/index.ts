import { loadCase } from '../../services/public-api';
Page({
  data: { item: null, loading: true, error: '' },
  caseId: '',
  onLoad(query: { id?: string }) { this.caseId = query.id || ''; this.refresh(); },
  async refresh() {
    this.setData({ loading: true, error: '' });
    try { const item = await loadCase(this.caseId); this.setData({ item }); if (item) wx.setNavigationBarTitle({ title: item.title }); }
    catch (_error) { this.setData({ error: '案例暂时无法加载，请稍后重试。' }); }
    finally { this.setData({ loading: false }); }
  },
  preview(event: WechatMiniprogram.TouchEvent) {
    if (this.data.item) wx.previewImage({ current: event.currentTarget.dataset.url, urls: this.data.item.images });
  },
  openContact() { wx.switchTab({ url: '/pages/contact/index' }); },
  onShareAppMessage() { return { title: this.data.item ? '鑫新装饰｜' + this.data.item.title : '鑫新装饰案例', path: '/pages/case-detail/index?id=' + encodeURIComponent(this.caseId) }; },
});
