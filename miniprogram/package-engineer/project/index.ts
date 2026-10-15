import { engineerRequest, showError } from '../../services/engineer-api';
import { catalogue } from '../../data/catalogue';
import type { StructurePlan } from '../../models/structure';
import { developmentLocation, isDevelopmentBuild, TEST_PROJECT_TITLE } from '../dev-fixtures';
import { checkPrivateStorage } from '../storage-check';
const { OPENINGS, PLAN_LIMITS, formatStructurePlan } = require('../../lib/structure-plan');
const jobLabels: Record<string, string> = { queued: '排队中', running: '生成中', succeeded: '已生成', failed: '生成失败' };
const reviewLabels: Record<string, string> = { pending: '待审核', approved: '已确认', rejected: '需调整' };
const assetLabels: Record<string, string> = { site_photo: '现场照片', sketch: '结构简图', material_reference: '材质参考', generated_image: '效果预览' };
const blankForm = () => ({ name: '', material: '', finish: '', color: '', widthMm: '', heightMm: '', depthMm: '', customerRequirements: '', structureNotes: '' });
const blankViews = () => ['正面整体', '左侧斜视', '右侧斜视', '室内向外'].map(angle => ({ angle, sourceIndex: -1, sourceLabel: '不生成此角度', sourceUrl: '' }));
const emptyPlan = (): StructurePlan => ({ version: 1, faces: [], glass: '', hardware: '', constraints: '' });
let editorId = 0;
const nextId = () => 'local-' + Date.now().toString(36) + '-' + (++editorId);
const emptyCell = (name: string) => ({ id: nextId(), name, widthMm: '', heightMm: '', opening: 'pending', openingIndex: 0, direction: '', notes: '' });

Page({
  data: { project: null, locations: [], selectedId: '', selected: null, assets: [], renders: [], jobs: [], shares: [], sitePhotos: [], sourceNames: [], views: blankViews(), loading: true, error: '', busy: false, editing: false, editingId: '', form: blankForm(), structurePlan: emptyPlan(), structureSummary: '', productLabel: '待确认', dimensionLabel: '未填写', openingLabels: OPENINGS.map(item => item.label), productOptions: catalogue.services.map(item => ({ id: item._id, title: item.title, checked: false })), selectedProducts: [], sharePath: '', shareExpiry: '', isDevelopmentTest: false },
  projectId: '',
  allAssets: [],
  allJobs: [],
  onLoad(query: { id?: string }) { this.projectId = query.id || ''; this.refresh(); },
  onShow() { if (this.projectId && !this.data.loading && !this.data.editing) this.refresh(); },
  async onPullDownRefresh() { try { await this.refresh(); } finally { wx.stopPullDownRefresh(); } },

  async refresh() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await engineerRequest('getProject', { projectId: this.projectId });
      this.allAssets = result.assets;
      this.allJobs = result.jobs;
      this.setData({ project: result.project, locations: result.locations, shares: result.shares.map(item => ({ ...item, expiryLabel: new Date(item.expiresAt).toLocaleDateString('zh-CN') })), isDevelopmentTest: isDevelopmentBuild() && result.project.title === TEST_PROJECT_TITLE });
      const selected = result.locations.find(item => item._id === this.data.selectedId) || result.locations[0] || null;
      this.selectLocation(selected);
      wx.setNavigationBarTitle({ title: result.project.title });
    } catch (_error) { this.setData({ error: '项目暂时无法加载，请检查工作台部署、权限或稍后重试。' }); }
    finally { this.setData({ loading: false }); }
  },

  selectLocation(selected: any) {
    const assets = this.allAssets.filter(item => selected && item.locationId === selected._id);
    const sitePhotos = assets.filter(item => item.type === 'site_photo');
    const dimensions = selected && selected.dimensions || {};
    const dimensionLabel = [['widthMm', '宽'], ['heightMm', '高'], ['depthMm', '深']].filter(([key]) => dimensions[key]).map(([key, label]) => label + ' ' + dimensions[key] + ' mm').join(' × ') || '未填写';
    const productLabel = selected && Array.isArray(selected.productTypes) ? selected.productTypes.map(type => catalogue.services.find(item => item._id === type)).filter(Boolean).map(item => item.title).join(' / ') || '待确认' : '待确认';
    this.setData({ selected, selectedId: selected ? selected._id : '', structureSummary: selected ? formatStructurePlan(selected.structurePlan) : '', dimensionLabel, productLabel, assets: assets.filter(item => item.type !== 'generated_image').map(item => ({ ...item, typeLabel: assetLabels[item.type] })), renders: assets.filter(item => item.type === 'generated_image').map(item => ({ ...item, reviewLabel: reviewLabels[item.reviewStatus] || '待审核' })), jobs: this.allJobs.filter(item => selected && item.locationId === selected._id).map(item => ({ ...item, statusLabel: jobLabels[item.status] || item.status })), sitePhotos, sourceNames: ['不生成此角度', ...sitePhotos.map((_item, index) => '现场照片 ' + (index + 1))], views: blankViews() });
  },
  chooseLocation(event: WechatMiniprogram.TouchEvent) { this.setData({ editing: false }); this.selectLocation(this.data.locations.find(item => item._id === event.currentTarget.dataset.id) || null); },
  addLocation() { this.setData({ editing: true, editingId: '', form: blankForm(), structurePlan: emptyPlan(), selectedProducts: [], productOptions: this.data.productOptions.map(item => ({ ...item, checked: false })) }); },
  editLocation() {
    const selected = this.data.selected;
    if (!selected) return;
    const structurePlan = selected.structurePlan ? { ...selected.structurePlan, faces: selected.structurePlan.faces.map(face => ({ ...face, cells: face.cells.map(cell => ({ ...cell, openingIndex: OPENINGS.findIndex(item => item.value === cell.opening) })) })) } : emptyPlan();
    this.setData({ editing: true, editingId: selected._id, form: { ...selected, ...selected.dimensions }, structurePlan, selectedProducts: selected.productTypes, productOptions: this.data.productOptions.map(item => ({ ...item, checked: selected.productTypes.includes(item.id) })) });
  },
  cancelEdit() { this.setData({ editing: false }); },
  async fillDevelopmentLocation(event: WechatMiniprogram.TouchEvent) {
    if (!isDevelopmentBuild() || !this.data.project || this.data.project.title !== TEST_PROJECT_TITLE || !this.data.editing || this.data.busy) return;
    const result = await wx.showModal({ title: '填入位置联调样例？', content: '仅替换当前未保存的表单，不会保存、上传或调用 AI。请核对后点击“保存位置”。' });
    if (!result.confirm) return;
    const sample = developmentLocation(event.currentTarget.dataset.kind);
    const faces = sample.structurePlan.faces.map(face => ({ ...face, cells: face.cells.map(cell => ({ ...cell, openingIndex: OPENINGS.findIndex(item => item.value === cell.opening) })) }));
    this.setData({ form: sample.form, structurePlan: { ...sample.structurePlan, faces }, selectedProducts: sample.productTypes, productOptions: this.data.productOptions.map(item => ({ ...item, checked: sample.productTypes.includes(item.id) })) });
  },
  chooseProducts(event: WechatMiniprogram.CheckboxGroupChange) { this.setData({ selectedProducts: event.detail.value }); },
  updateForm(event: WechatMiniprogram.Input) {
    const field = event.currentTarget.dataset.field;
    if (Object.prototype.hasOwnProperty.call(blankForm(), field)) this.setData({ form: { ...this.data.form, [field]: event.detail.value } });
  },
  updatePlan(event: WechatMiniprogram.Input) {
    const { faceId, cellId, field } = event.currentTarget.dataset;
    const value = event.detail.value;
    if (!faceId && ['glass', 'hardware', 'constraints'].includes(field)) { this.setData({ structurePlan: { ...this.data.structurePlan, [field]: value } }); return; }
    const faces = this.data.structurePlan.faces.map(face => {
      if (face.id !== faceId) return face;
      if (!cellId && ['name', 'widthMm', 'heightMm', 'corner', 'obstacles'].includes(field)) return { ...face, [field]: value };
      return { ...face, cells: face.cells.map(cell => cell.id === cellId && ['name', 'widthMm', 'heightMm', 'direction', 'notes'].includes(field) ? { ...cell, [field]: value } : cell) };
    });
    this.setData({ structurePlan: { ...this.data.structurePlan, faces } });
  },
  addFace() {
    if (this.data.structurePlan.faces.length >= PLAN_LIMITS.faces) { showError(new Error('每个安装位置最多记录 6 个安装面。')); return; }
    const face = { id: nextId(), name: '安装面 ' + (this.data.structurePlan.faces.length + 1), widthMm: '', heightMm: '', corner: '', obstacles: '', cells: [emptyCell('分格 1')] };
    this.setData({ structurePlan: { ...this.data.structurePlan, faces: [...this.data.structurePlan.faces, face] } });
  },
  addCell(event: WechatMiniprogram.TouchEvent) {
    const faceId = event.currentTarget.dataset.faceId;
    const face = this.data.structurePlan.faces.find(item => item.id === faceId);
    if (!face) return;
    if (face.cells.length >= PLAN_LIMITS.cells) { showError(new Error('每个安装面最多记录 12 个分格。')); return; }
    const faces = this.data.structurePlan.faces.map(item => item.id === faceId ? { ...item, cells: [...item.cells, emptyCell('分格 ' + (item.cells.length + 1))] } : item);
    this.setData({ structurePlan: { ...this.data.structurePlan, faces } });
  },
  async removeStructure(event: WechatMiniprogram.TouchEvent) {
    const { faceId, cellId } = event.currentTarget.dataset;
    const confirm = await wx.showModal({ title: cellId ? '移除此分格？' : '移除此安装面？', content: '只修改当前未保存的编辑草稿；取消编辑可恢复上次保存的方案。' });
    if (!confirm.confirm) return;
    const faces = cellId ? this.data.structurePlan.faces.map(face => face.id === faceId ? { ...face, cells: face.cells.filter(cell => cell.id !== cellId) } : face) : this.data.structurePlan.faces.filter(face => face.id !== faceId);
    this.setData({ structurePlan: { ...this.data.structurePlan, faces } });
  },
  chooseOpening(event: WechatMiniprogram.PickerChange) {
    const { faceId, cellId } = event.currentTarget.dataset;
    const openingIndex = Number(event.detail.value);
    if (!OPENINGS[openingIndex]) return;
    const faces = this.data.structurePlan.faces.map(face => face.id === faceId ? { ...face, cells: face.cells.map(cell => cell.id === cellId ? { ...cell, opening: OPENINGS[openingIndex].value, openingIndex } : cell) } : face);
    this.setData({ structurePlan: { ...this.data.structurePlan, faces } });
  },
  async saveLocation(event: WechatMiniprogram.FormSubmit) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const value = event.detail.value;
      const result = await engineerRequest('saveLocation', { projectId: this.projectId, locationId: this.data.editingId || undefined, location: { name: value.name, productTypes: this.data.selectedProducts, dimensions: { widthMm: value.widthMm, heightMm: value.heightMm, depthMm: value.depthMm }, material: value.material, finish: value.finish, color: value.color, customerRequirements: value.customerRequirements, structureNotes: value.structureNotes, structurePlan: this.data.structurePlan } });
      this.setData({ editing: false, selectedId: result.locationId });
      await this.refresh();
    } catch (error) { showError(error); }
    finally { this.setData({ busy: false }); }
  },

  async upload() {
    if (this.data.busy || !this.data.selectedId) return;
    try {
      const type = await wx.showActionSheet({ itemList: ['现场照片', '工程师结构简图', '材质 / 颜色参考'] });
      const selected = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'] });
      const file = selected.tempFiles[0];
      if (!file) return;
      let filePath = file.tempFilePath;
      if (file.size > 8 * 1024 * 1024) filePath = (await wx.compressImage({ src: filePath, quality: 75 })).tempFilePath;
      this.setData({ busy: true });
      wx.showLoading({ title: '正在上传资料', mask: true });
      const ticket = await engineerRequest('prepareUpload', { projectId: this.projectId, locationId: this.data.selectedId, type: ['site_photo', 'sketch', 'material_reference'][type.tapIndex], extension: /\.png$/i.test(filePath) ? 'png' : 'jpg' });
      const uploaded = await wx.cloud.uploadFile({ cloudPath: ticket.cloudPath, filePath });
      await engineerRequest('finalizeUpload', { projectId: this.projectId, assetId: ticket.assetId, fileID: uploaded.fileID });
      await this.refresh();
    } catch (error) {
      if (error && typeof error === 'object' && 'errMsg' in error && String(error.errMsg).includes('cancel')) return;
      showError(error instanceof Error ? error : new Error('上传失败。请确认图片格式，以及云存储中已为当前工程师配置上传权限。'));
    } finally { this.setData({ busy: false }); wx.hideLoading(); }
  },

  async verifyDevelopmentStorage() {
    if (!isDevelopmentBuild() || !this.data.project || this.data.project.title !== TEST_PROJECT_TITLE || !this.data.selectedId || this.data.busy) return;
    const consent = await wx.showModal({ title: '验证私有存储？', content: '仅上传内置合成色块图到当前测试位置，检查私有直读 / 直写限制与授权预览。测试图会保留，不调用 AI、不创建分享。权限未生效时会中止，请勿反复点击。' });
    if (!consent.confirm) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '验证存储权限', mask: true });
    try {
      const steps = await checkPrivateStorage(this.projectId, this.data.selectedId);
      await this.refresh();
      wx.hideLoading();
      await wx.showModal({ title: '存储验证通过', content: steps.join('\n') + '\n未验证其他微信身份；未调用 AI。', showCancel: false });
    } catch (error) { wx.hideLoading(); showError(error); }
    finally { this.setData({ busy: false }); }
  },

  preview(event: WechatMiniprogram.TouchEvent) { const url = event.currentTarget.dataset.url; if (url) wx.previewImage({ current: url, urls: [url] }); },
  chooseSource(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.currentTarget.dataset.index);
    const choice = Number(event.detail.value);
    const sourceIndex = choice - 1;
    if (!this.data.views[index] || (choice !== 0 && !this.data.sitePhotos[sourceIndex])) return;
    const views = this.data.views.map((view, i) => i === index ? { ...view, sourceIndex, sourceLabel: this.data.sourceNames[choice], sourceUrl: choice ? this.data.sitePhotos[sourceIndex].previewUrl : '' } : view);
    this.setData({ views });
  },
  async generate() {
    if (this.data.busy) return;
    const views = this.data.views.filter(view => view.sourceIndex >= 0).map(view => ({ angle: view.angle, sourceAssetId: this.data.sitePhotos[view.sourceIndex]._id }));
    if (!views.length) { showError(new Error('请先为需要生成的角度选择现场照片。')); return; }
    if (new Set(views.map(view => view.sourceAssetId)).size !== views.length) { showError(new Error('不同角度需要选择不同的现场照片。')); return; }
    wx.navigateTo({ url: '/package-engineer/generation/index?projectId=' + encodeURIComponent(this.projectId) + '&locationId=' + encodeURIComponent(this.data.selectedId) + '&views=' + encodeURIComponent(JSON.stringify(views)) });
  },

  async review(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const decision = event.currentTarget.dataset.decision;
    const confirm = await wx.showModal({ title: decision === 'approved' ? '确认审核通过？' : '标记为需要调整？', content: decision === 'approved' ? '请确认已核对：结构、产品数量、材质、颜色，以及与其他角度的一致性。确认后此图才可用于客户分享。' : '该图片将不会出现在客户分享中。', confirmText: decision === 'approved' ? '核对并确认' : '需要调整' });
    if (!confirm.confirm) return;
    this.setData({ busy: true });
    try { await engineerRequest('reviewAsset', { projectId: this.projectId, assetId: event.currentTarget.dataset.id, decision, checklist: { structure: true, count: true, material: true, color: true, angles: true } }); await this.refresh(); }
    catch (error) { showError(error); }
    finally { this.setData({ busy: false }); }
  },
  async retryJob(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const confirm = await wx.showModal({ title: '重试生成？', content: '重试会重新调用 AI，可能消耗生图资源。请先处理失败原因。' });
    if (!confirm.confirm) return;
    this.setData({ busy: true });
    try { await engineerRequest('retryGeneration', { projectId: this.projectId, jobId: event.currentTarget.dataset.id }); await this.refresh(); }
    catch (error) { showError(error); }
    finally { this.setData({ busy: false }); }
  },
  async createShare() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const result = await engineerRequest('createShare', { projectId: this.projectId });
      this.setData({ sharePath: result.sharePath, shareExpiry: new Date(result.expiresAt).toLocaleDateString('zh-CN') });
      await this.refresh();
    } catch (error) { showError(error); }
    finally { this.setData({ busy: false }); }
  },
  previewShare() { if (this.data.sharePath) wx.navigateTo({ url: this.data.sharePath }); },
  async disableShare(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const confirm = await wx.showModal({ title: '停用这条分享？', content: '停用后无法再通过这条链接获取效果图，已经下载或缓存的图片不会自动消失。' });
    if (!confirm.confirm) return;
    this.setData({ busy: true });
    try { await engineerRequest('disableShare', { projectId: this.projectId, shareId: event.currentTarget.dataset.id }); this.setData({ sharePath: '' }); await this.refresh(); }
    catch (error) { showError(error); }
    finally { this.setData({ busy: false }); }
  },
  onShareAppMessage() { return this.data.sharePath ? { title: '鑫新装饰｜您的专属项目效果预览', path: this.data.sharePath } : { title: '鑫新装饰', path: '/pages/index/index' }; },
});
