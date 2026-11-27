// The app's watchdog (2026-11-28, blank-page report). Loaded async from v3.html, outside the app's bundle, so it
// still runs when the bundle never arrives or never starts. 15 s after the page began, if nothing has been drawn
// into #root, the tab reloads once (sessionStorage remembers it; src/v3/main.tsx then reports `boot_retried` to
// PostHog). Still blank after that reload: a plain line with a Reload link instead of a black page. It never
// reloads twice in one tab, so it cannot loop. React clears whatever is in #root when it does start.
(function () {
  var KEY = 'relatch_boot_retry';
  setTimeout(function () {
    var root = document.getElementById('root');
    if (!root || root.childElementCount) return;
    var retried;
    try { retried = sessionStorage.getItem(KEY); if (!retried) sessionStorage.setItem(KEY, '1'); } catch (e) { retried = 'no storage'; }
    if (!retried) { location.reload(); return; }
    root.innerHTML = '<p style="margin:0;padding:40vh 24px 0;text-align:center;font:16px/1.5 system-ui,sans-serif;color:#a1a1a1;background:#000;min-height:100vh;box-sizing:border-box">'
      + 'Relatch is taking longer than it should to load. <a href="" style="color:#ededed">Reload</a></p>';
  }, 15000);
})();
