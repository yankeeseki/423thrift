/* v32.1: "Meet This Month's Enablers" box at the end of every blog. Content lives in /blog-enablers.json (edit that file monthly). */
(function () {
  var host = document.getElementById('ctt-blog-enablers'); if (!host) return;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var css = '#ctt-blog-enablers{margin:22px 0 8px}.cen{background:#fbf6ea;border:2px solid #c98a2b;border-radius:14px;padding:16px 16px 14px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#2c2417}'
    + '.cen-h{margin:0 0 4px;font:400 22px/1.15 "Archivo Black",Georgia,serif;color:#ae4c2c;text-align:center}'
    + '.cen-i{margin:0 auto 14px;max-width:34em;font-size:15px;line-height:1.45;color:#6b6252;text-align:center}'
    + '.cen-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}'
    + '.cen-c{background:#f2ead9;border:1px solid #c9bb99;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;min-width:0}'
    + '.cen-c img{display:block;width:100%;height:150px;object-fit:cover;background:#c9bb99}'
    + '.cen-b{padding:10px 12px 12px;display:flex;flex-direction:column;gap:6px;flex:1}'
    + '.cen-n{margin:0;font:800 17px/1.2 system-ui,sans-serif;color:#2c2417}'
    + '.cen-t{margin:0;font-size:14px;line-height:1.45;color:#2c2417}'
    + '.cen-l{margin:auto 0 0;padding-top:4px;display:flex;flex-wrap:wrap;gap:4px 14px;font-weight:700;font-size:14px}'
    + '.cen-l a{color:#ae4c2c;text-decoration:underline;text-underline-offset:2px}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  fetch('/blog-enablers.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) {
    if (!d || !d.enablers || !d.enablers.length) return;
    var h = '<section class="cen" aria-label="Enablers"><h2 class="cen-h">' + esc(d.title || "Meet This Month's Enablers") + '</h2><p class="cen-i">' + esc(d.intro || '') + '</p><div class="cen-g">';
    d.enablers.forEach(function (e) {
      h += '<div class="cen-c">' + (e.img ? '<img src="' + esc(e.img) + '" alt="' + esc(e.name) + '" loading="lazy" onerror="this.remove()">' : '') + '<div class="cen-b"><h3 class="cen-n">' + esc(e.name) + '</h3><p class="cen-t">' + esc(e.blurb || '') + '</p><p class="cen-l">'
        + (e.links || []).map(function (l) { return '<a href="' + esc(l.u) + '" target="_blank" rel="noopener" data-en="' + esc(e.name) + '">' + esc(l.t) + '</a>'; }).join('') + '</p></div></div>';
    });
    host.innerHTML = h + '</div></section>';
    host.addEventListener('click', function (ev) { var a = ev.target.closest && ev.target.closest('a[data-en]'); if (!a) return; try { gtag('event', 'enabler_click', { enabler: a.getAttribute('data-en'), link: a.textContent.trim(), source: 'blog' }); } catch (x) {} });
  }).catch(function () {});
})();
