// app.js
App({
  globalData: {
    groups: []
  },
  onLaunch() {
    this.refreshGroups();
  },
  refreshGroups() {
    this.globalData.groups = wx.getStorageSync('groups') || [];
  }
});
