import { contactStore, loadCatalogue } from '../../services/public-api';
Page({
  data: { service: null, phones: [], loading: true, error: '', localPreview: false },
  serviceId: '',
  onLoad(query: { id?: string }) { this.serviceId = query.id || ''; this.refresh(); },
  async refresh() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await loadCatalogue();
      const service = result.data.services.find(item => item._id === this.serviceId) || null;
      this.setData({ service, phones: result.data.store.phones, localPreview: result.source === 'local' });
      if (service) wx.setNavigationBarTitle({ title: service.title });
    } catch (_error) { this.setData({ error: '业务资料暂时无法加载。' }); }
    finally { this.setData({ loading: false }); }
  },
  async call() { try { await contactStore(this.data.phones); } catch (_error) { /* 用户取消。 */ } },
  openContact() { wx.switchTab({ url: '/pages/contact/index' }); },
  onShareAppMessage() { return { title: this.data.service ? '鑫新装饰｜' + this.data.service.title : '鑫新装饰', path: '/pages/service-detail/index?id=' + encodeURIComponent(this.serviceId) }; },
});
