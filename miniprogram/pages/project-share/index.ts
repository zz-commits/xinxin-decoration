import { cloudConfig } from '../../config/cloud';
Page({
  data: { project: null, selectedIndex: 0, location: null, loading: true, error: '', expandedImage: '', expandedAngle: '' },
  code: '',
  onLoad(query: { code?: string }) { this.code = query.code || ''; this.refresh(); },
  async onPullDownRefresh() { try { await this.refresh(); } finally { wx.stopPullDownRefresh(); } },
  async refresh() {
    this.setData({ loading: true, error: '' });
    try {
      if (!/^[a-f0-9]{48}$/.test(this.code) || !getApp().globalData.cloudReady) { this.setData({ project: null, location: null }); return; }
      const response = await wx.cloud.callFunction({ name: 'share-api', data: { code: this.code }, config: { env: cloudConfig.envId } });
      const result = response.result as { ok: boolean; data: any };
      if (!result || !result.ok) throw new Error('SHARE_UNAVAILABLE');
      const project = result.data;
      const selectedIndex = project && project.locations[this.data.selectedIndex] ? this.data.selectedIndex : 0;
      this.setData({ project, selectedIndex, location: project ? project.locations[selectedIndex] : null });
    } catch (_error) { this.setData({ error: '方案暂时无法加载，请稍后重试或联系工程师。' }); }
    finally { this.setData({ loading: false }); }
  },
  chooseLocation(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    if (this.data.project && this.data.project.locations[index]) this.setData({ selectedIndex: index, location: this.data.project.locations[index] });
  },
  expand(event: WechatMiniprogram.TouchEvent) { this.setData({ expandedImage: event.currentTarget.dataset.url, expandedAngle: event.currentTarget.dataset.angle }); },
  closeImage() { this.setData({ expandedImage: '', expandedAngle: '' }); },
  preventBubble() {},
  openContact() { wx.switchTab({ url: '/pages/contact/index' }); },
  onShareAppMessage() { return this.data.project ? { title: '鑫新装饰｜专属项目效果预览', path: '/pages/project-share/index?code=' + this.code } : { title: '鑫新装饰', path: '/pages/index/index' }; },
});
