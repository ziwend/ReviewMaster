// app.js
App({
  globalData: {
    groups: []
  },
  onLaunch() {
    // 使用异步方式初始化全局数据，避免启动延迟
    this.globalData.groups = []; // 先初始化为空数组
    
    // 异步加载组数据
    setTimeout(() => {
      this.globalData.groups = require('./utils/storage').getAllGroups();
    }, 100);
  },

});
