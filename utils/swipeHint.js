// utils/swipeHint.js

// 通用滑动提示节流与状态管理
function createSwipeHandler(type) {
  let throttleTimer = null;
  let lastHint = '';
  let lastX = null;
  let lastY = null;

  return {
    updateHint: function(newHint, x, y) {
      if (newHint === lastHint && x === lastX && y === lastY) return;
      lastHint = newHint;
      lastX = x;
      lastY = y;
      if (throttleTimer) return;
      throttleTimer = setTimeout(() => {
        this.setData({
          [`${type}SwipeHint`]: newHint,
          [`${type}SwipeHintX`]: x,
          [`${type}SwipeHintY`]: y
        });
        throttleTimer = null;
      }, 100);
    },
    reset: function() {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      lastHint = '';
      lastX = null;
      lastY = null;
      this.setData({
        [`${type}SwipeHint`]: '',
        [`${type}SwipeHintX`]: null,
        [`${type}SwipeHintY`]: null
      });
    }
  };
}

module.exports = {
  createSwipeHandler
}; 