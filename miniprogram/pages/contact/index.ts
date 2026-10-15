import { isDevelopment, loadCatalogue } from '../../services/public-api';
Page({
  data: { store: null, loading: true, error: '', localPreview: false, development: isDevelopment() },
  onLoad() { this.refresh(); },
  onShow() { const bar = this.getTabBar(); if (bar) bar.setData({ selected: 3 }); },
  async onPullDownRefresh() { try { await this.refresh(); } finally { wx.stopPullDownRefresh(); } },
  async refresh() {
    this.setData({ loading: true, error: '' });
    try { const result = await loadCatalogue(); this.setData({ store: result.data.store, localPreview: result.source === 'local' }); }
    catch (_error) { this.setData({ error: '店铺资料暂时无法加载。' }); }
    finally { this.setData({ loading: false }); }
  },
  async call(event: WechatMiniprogram.TouchEvent) {
    const phone = event.currentTarget.dataset.phone;
    try {
      if (this.data.store && this.data.store.phones.includes(phone)) await wx.makePhoneCall({ phoneNumber: phone });
    } catch (_error) { /* 取消拨号不应产生未处理的 Promise 错误。 */ }
  },
  copyAddress() { if (this.data.store && this.data.store.address) wx.setClipboardData({ data: this.data.store.address }); },
  copyWechat() { if (this.data.store && this.data.store.wechatId) wx.setClipboardData({ data: this.data.store.wechatId }); },
  previewQr() { if (this.data.store && this.data.store.wechatQrImage) wx.previewImage({ urls: [this.data.store.wechatQrImage] }); },
  openDeveloper() { wx.navigateTo({ url: '/pages/developer/index' }); },
  openEngineer() { wx.navigateTo({ url: '/package-engineer/projects/index' }); },
  onShareAppMessage() { return { title: '鑫新装饰｜电话与店铺地址', path: '/pages/contact/index' }; },
});
