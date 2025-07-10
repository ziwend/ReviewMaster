// app.js
App({
  globalData: {
    groups: []
  },
  onLaunch() {
    this.globalData.groups = require('./utils/storage').perfGetStorageSync('groups') || [];
  },

});
