Component({
  data: {
    selected: 0,
    items: [
      { text: '首页', path: '/pages/index/index', icon: 'home' },
      { text: '业务', path: '/pages/services/index', icon: 'services' },
      { text: '案例', path: '/pages/cases/index', icon: 'cases' },
      { text: '联系', path: '/pages/contact/index', icon: 'contact' },
    ],
  },
  methods: {
    switchTab(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index);
      const item = this.data.items[index];
      if (!item || index === this.data.selected) return;
      wx.switchTab({ url: item.path });
    },
  },
});
