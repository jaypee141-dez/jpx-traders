(function () {
  var t = localStorage.getItem('jpx_theme') || 'system';
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  window.JPXTheme = {
    get: function () { return localStorage.getItem('jpx_theme') || 'system'; },
    set: function (v) {
      localStorage.setItem('jpx_theme', v);
      var d = v === 'dark' || (v === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = d ? 'dark' : 'light';
      window.dispatchEvent(new Event('jpx-theme'));
    },
  };
})();
