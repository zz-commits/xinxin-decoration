import { catalogue } from '../../data/catalogue';
import { engineerRequest, showError } from '../../services/engineer-api';
const blankFlags = () => ({ structure: false, materials: false, views: false, usage: false });

Page({
  data: { loading: true, error: '', preview: null, productLabel: '', dimensionLabel: '', checkFlags: blankFlags(), confirmed: false, submitting: false, submitted: false },
  projectId: '',
  locationId: '',
  views: [],
  onLoad(query: { projectId?: string; locationId?: string; views?: string }) {
    this.projectId = query.projectId || '';
    this.locationId = query.locationId || '';
    try { this.views = JSON.parse(query.views || '[]'); } catch (_error) { this.views = []; }
    this.refresh();
  },
  async onPullDownRefresh() { try { await this.refresh(); } finally { wx.stopPullDownRefresh(); } },
  async refresh() {
    if (this.data.submitting || this.data.submitted) return;
    this.setData({ loading: true, error: '', checkFlags: blankFlags(), confirmed: false, preview: null });
    try {
      const preview = await engineerRequest('getGenerationPreview', { projectId: this.projectId, locationId: this.locationId, views: this.views });
      const location = preview.location;
      const dimensionLabel = Object.entries(location.dimensions).map(([key, value]) => ({ widthMm: '宽 / 长', heightMm: '高', depthMm: '深' }[key] || key) + ' ' + value + ' mm').join(' · ');
      this.setData({ preview, dimensionLabel, productLabel: location.productTypes.map(id => (catalogue.services.find(item => item._id === id) || { title: id }).title).join('、') });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '方案暂时无法读取，请返回项目检查已保存的资料。' }); }
    finally { this.setData({ loading: false }); }
  },
  chooseChecks(event: WechatMiniprogram.CheckboxGroupChange) {
    const checks = event.detail.value;
    this.setData({ checkFlags: { structure: checks.includes('structure'), materials: checks.includes('materials'), views: checks.includes('views'), usage: checks.includes('usage') }, confirmed: ['structure', 'materials', 'views', 'usage'].every(key => checks.includes(key)) });
  },
  previewImage(event: WechatMiniprogram.TouchEvent) { const url = event.currentTarget.dataset.url; if (url) wx.previewImage({ current: url, urls: [url] }); },
  back() { wx.navigateBack({ delta: 1 }); },
  async submit() {
    if (!this.data.confirmed || !this.data.preview || this.data.submitting || this.data.submitted) return;
    const confirm = await wx.showModal({ title: '提交 ' + this.data.preview.views.length + ' 张生成任务？', content: '任务被服务端处理后会消耗 CloudBase 生图资源。输出仍需单独审核，不会自动分享给客户。', confirmText: '确认提交' });
    if (!confirm.confirm) return;
    this.setData({ submitting: true });
    try {
      await engineerRequest('createGeneration', { projectId: this.projectId, locationId: this.locationId, views: this.views, confirmationDigest: this.data.preview.confirmationDigest, checklist: { structure: true, materials: true, views: true, usage: true } });
      this.setData({ submitted: true, confirmed: false });
      wx.showToast({ title: '已加入生成队列', icon: 'success' });
      wx.navigateBack({ delta: 1 });
    } catch (error) {
      this.setData({ confirmed: false, checkFlags: blankFlags() });
      showError(error);
    } finally { this.setData({ submitting: false }); }
  },
});
