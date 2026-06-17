'use strict';
(function () {
  const statusMain  = document.getElementById('statusMain');
  const statusSub   = document.getElementById('statusSub');
  const openAppSection = document.getElementById('openAppSection');
  const btnOpenApp  = document.getElementById('btnOpenApp');
  const downloadSection = document.getElementById('downloadSection');
  const downloadLinkEl  = document.getElementById('downloadLink');
  const downloadUrlEl   = document.getElementById('downloadUrl');
  const btnCopy    = document.getElementById('btnCopy');

  const isWechat = /MicroMessenger/i.test(navigator.userAgent);
  var appOpened = false;
  var currentSchemeUrl = '';
  const downloadUrl = location.origin + '/factory-control.apk';
  const urlParams = new URLSearchParams(location.search);
  const sessionId = urlParams.get('sessionId') || '';
  const areaParam = urlParams.get('area') || '';
  const deviceToken = urlParams.get('dt') || '';

  function setStatus(main, sub) {
    statusMain.textContent = main;
    statusSub.textContent  = sub || '';
  }

  if (isWechat) {
    // 微信内：只提示"在浏览器中打开"，不做任何唤起 / 下载动作
    setStatus(
      '请在浏览器中继续操作',
      '登记已完成。请点击右上角的「⋯」按钮，在菜单中选择「在默认浏览器中打开」本页，然后按提示安装/打开 APP。'
    );
  } else {
    // 系统浏览器：尝试唤起 APP，失败则展示下载方式
    if (!sessionId) {
      setStatus('缺少会话信息', '请返回上一页重新扫码登记。');
      return;
    }

    setStatus('正在打开 APP…', '如几秒内未跳转，可点击下方按钮再次尝试。');
    var server = location.origin;
    currentSchemeUrl =
      'factorycontrol://checkin?sessionId=' + encodeURIComponent(sessionId) +
      '&server=' + encodeURIComponent(server) +
      (deviceToken ? '&dt=' + encodeURIComponent(deviceToken) : '');

    try { window.location.href = currentSchemeUrl; } catch (_) {}

    document.addEventListener('visibilitychange', function() {
      if (document.hidden) appOpened = true;
    });
    window.addEventListener('pagehide', function() { appOpened = true; });
    window.addEventListener('blur', function() { appOpened = true; });

    // 约 1 秒后显示「打开 APP」按钮（已安装但未自动唤起时可点）
    setTimeout(function() {
      if (appOpened) return;
      openAppSection.classList.add('show');
    }, 1000);

    // 约 2.5 秒后若仍在页面上，视为未安装，只显示下载区块
    setTimeout(function() {
      if (appOpened) return;
      openAppSection.classList.remove('show');
      downloadLinkEl.href = downloadUrl;
      downloadUrlEl.textContent = downloadUrl;
      downloadSection.classList.add('show');
      setStatus('未检测到「厂区管控」APP', '请点击下方按钮或链接下载，安装后重新扫描自助入场码。');
    }, 2500);
  }

  btnOpenApp.addEventListener('click', function() {
    if (currentSchemeUrl) window.location.href = currentSchemeUrl;
  });

  btnCopy.addEventListener('click', function() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(downloadUrl).then(function() {
        btnCopy.textContent = '已复制';
        setTimeout(function() { btnCopy.textContent = '复制链接'; }, 2000);
      }).catch(function() { btnCopy.textContent = '请长按上方链接复制'; });
    } else {
      btnCopy.textContent = '请长按上方链接复制';
    }
  });
})();
