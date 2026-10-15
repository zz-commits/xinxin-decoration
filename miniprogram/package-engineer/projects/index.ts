import { engineerRequest, showError } from '../../services/engineer-api';
import { developmentProjectForm, isDevelopmentBuild } from '../dev-fixtures';

const labels: Record<string, string> = { draft: '草稿', collecting: '资料录入中', generating: '生成中', reviewing: '待审核', shareable: '可分享', archived: '已归档' };
Page({
  data: { profile: null, items: [], loading: true, error: '', showCreate: false, saving: false, isDevelopment: false, projectForm: { title: '', customerDisplayName: '', community: '' } },
  onShow() { this.setData({ isDevelopment: isDevelopmentBuild() }); this.refresh(); },
  async onPullDownRefresh() { try { await this.refresh(); } finally { wx.stopPullDownRefresh(); } },
  async refresh() {
    this.setData({ loading: true, error: '' });
    try {
      const profile = await engineerRequest('getProfile');
      this.setData({ profile });
      if (profile.authorized) {
        const result = await engineerRequest('listProjects');
        this.setData({ items: result.items.map(item => ({ ...item, statusLabel: labels[item.status] || item.status })) });
      }
    } catch (_error) { this.setData({ error: '工作台尚未接通。请确认 engineer-api 已部署、users 等数据库集合已建立。' }); }
    finally { this.setData({ loading: false }); }
  },
  copyIdentity() { if (this.data.profile && this.data.profile.openid) wx.setClipboardData({ data: this.data.profile.openid }); },
  toggleCreate() { this.setData({ showCreate: !this.data.showCreate }); },
  updateProjectForm(event: WechatMiniprogram.Input) {
    const field = event.currentTarget.dataset.field;
    if (['title', 'customerDisplayName', 'community'].includes(field)) this.setData({ projectForm: { ...this.data.projectForm, [field]: event.detail.value } });
  },
  async fillDevelopmentProject() {
    if (!isDevelopmentBuild() || !this.data.profile || !this.data.profile.authorized || !this.data.showCreate || this.data.saving) return;
    const result = await wx.showModal({ title: '填入联调样例？', content: '仅替换当前未保存表单，不会自动创建项目。样例不含真实客户资料，不用于施工或客户分享。' });
    if (result.confirm) this.setData({ projectForm: developmentProjectForm() });
  },
  async createProject(event: WechatMiniprogram.FormSubmit) {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      const result = await engineerRequest('createProject', event.detail.value);
      this.setData({ showCreate: false, projectForm: { title: '', customerDisplayName: '', community: '' } });
      wx.navigateTo({ url: '/package-engineer/project/index?id=' + result.projectId });
    } catch (error) { showError(error); }
    finally { this.setData({ saving: false }); }
  },
  openProject(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: '/package-engineer/project/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) }); },
});
