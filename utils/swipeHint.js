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

// 节流工具函数
function throttle(fn, delay) {
  let lastCall = 0;
  let timer = null;
  function throttled(...args) {
    const now = Date.now();
    if (now - lastCall < delay) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        lastCall = Date.now();
        fn.apply(this, args);
      }, delay);
    } else {
      lastCall = now;
      fn.apply(this, args);
    }
  }
  throttled.clear = function() {
    clearTimeout(timer);
    timer = null;
  };
  return throttled;
}

module.exports = {
  createSwipeHandler,
  throttle
}; 