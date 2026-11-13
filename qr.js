/* Tiny QR code encoder for the Trail's "Send To My Phone" (byte mode, error correction L, versions 1-20).
   window.cttQR(text) returns {n: size, m: [[bool,...],...]} or null when the text is too long. No network needed. */
(function () {
  var EXP = [], LOG = [], x = 1, i;
  for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function gen(n) { var g = [1], j, k; for (k = 0; k < n; k++) { var ng = []; for (j = 0; j <= g.length; j++) ng[j] = 0; for (j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[k]); } g = ng; } return g; }
  function ecc(data, n) { var g = gen(n), r = [], j; for (j = 0; j < n; j++) r.push(0); data.forEach(function (d) { var f = d ^ r[0]; r.shift(); r.push(0); for (var q = 0; q < n; q++) r[q] ^= mul(g[q + 1], f); }); return r; }
  // version: [ecc codewords per block, blocks in group 1, data codewords each, blocks in group 2, data codewords each]
  var TAB = [null, [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69],
    [20, 4, 81, 0, 0], [24, 2, 92, 2, 93], [26, 4, 107, 0, 0], [30, 3, 115, 1, 116], [22, 5, 87, 1, 88], [24, 5, 98, 1, 99], [28, 1, 107, 5, 108], [30, 5, 120, 1, 121], [28, 3, 113, 4, 114], [28, 3, 107, 5, 108]];
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]];
  function dataCw(v) { var t = TAB[v]; return t[1] * t[2] + t[3] * t[4]; }
  function bch(v, g) { var d = v, top = function (z) { var c = 0; while (z) { c++; z >>>= 1; } return c; }; while (top(d) - top(g) >= 0) d ^= g << (top(d) - top(g)); return d; }
  function maskFn(p, r, c) {
    switch (p) {
      case 0: return (r + c) % 2 === 0; case 1: return r % 2 === 0; case 2: return c % 3 === 0; case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; case 5: return (r * c) % 2 + (r * c) % 3 === 0;
      case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0; default: return ((r * c) % 3 + (r + c) % 2) % 2 === 0;
    }
  }
  function utf8(s) { var b = unescape(encodeURIComponent(s)), o = [], k; for (k = 0; k < b.length; k++) o.push(b.charCodeAt(k)); return o; }
  function penalty(m, n) {
    var p = 0, r, c, k;
    for (r = 0; r < n; r++) for (var dir = 0; dir < 2; dir++) { var run = 1, last = null; for (c = 0; c < n; c++) { var v = dir ? m[c][r] : m[r][c]; if (v === last) run++; else { if (run >= 5) p += 3 + run - 5; run = 1; last = v; } } if (run >= 5) p += 3 + run - 5; }
    for (r = 0; r < n - 1; r++) for (c = 0; c < n - 1; c++) { var s = m[r][c] + m[r][c + 1] + m[r + 1][c] + m[r + 1][c + 1]; if (s === 0 || s === 4) p += 3; }
    var pat = [1, 0, 1, 1, 1, 0, 1], dark = 0;
    for (r = 0; r < n; r++) for (c = 0; c < n; c++) { if (m[r][c]) dark++;
      for (var d2 = 0; d2 < 2; d2++) { if (d2 ? r + 10 >= n : c + 10 >= n) continue; var ok1 = true, ok2 = true;
        for (k = 0; k < 7; k++) { var a = d2 ? m[r + k][c] : m[r][c + k]; var b = d2 ? m[r + 4 + k][c] : m[r][c + 4 + k]; if ((a ? 1 : 0) !== pat[k]) ok1 = false; if ((b ? 1 : 0) !== pat[k]) ok2 = false; }
        if (ok1) { var z1 = true; for (k = 7; k < 11; k++) if (d2 ? m[r + k][c] : m[r][c + k]) z1 = false; if (z1) p += 40; }
        if (ok2) { var z2 = true; for (k = 0; k < 4; k++) if (d2 ? m[r + k][c] : m[r][c + k]) z2 = false; if (z2) p += 40; } } }
    p += Math.floor(Math.abs(dark * 20 / (n * n) - 10)) * 10;
    return p;
  }
  window.cttQR = function (text) {
    var bytes = utf8(String(text)), v, k, r, c;
    for (v = 1; v <= 20; v++) { var bits = 4 + (v < 10 ? 8 : 16) + 8 * bytes.length; if (dataCw(v) * 8 >= bits) break; }
    if (v > 20) return null;
    var buf = [], put = function (val, len) { for (var q = len - 1; q >= 0; q--) buf.push((val >>> q) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCw(v) * 8; for (k = 0; k < 4 && buf.length < cap; k++) buf.push(0);
    while (buf.length % 8) buf.push(0);
    var cw = []; for (k = 0; k < buf.length; k += 8) { var by = 0; for (var q = 0; q < 8; q++) by = (by << 1) | buf[k + q]; cw.push(by); }
    for (k = 0; cw.length < dataCw(v); k++) cw.push(k % 2 ? 0x11 : 0xEC);
    var t = TAB[v], blocks = [], pos = 0, ecs = [];
    for (k = 0; k < t[1] + t[3]; k++) { var len = k < t[1] ? t[2] : t[4]; var bl = cw.slice(pos, pos + len); pos += len; blocks.push(bl); ecs.push(ecc(bl, t[0])); }
    var out = [], maxd = Math.max(t[2], t[4]);
    for (k = 0; k < maxd; k++) blocks.forEach(function (bl) { if (k < bl.length) out.push(bl[k]); });
    for (k = 0; k < t[0]; k++) ecs.forEach(function (e) { out.push(e[k]); });
    var n = 17 + 4 * v, m = [];
    for (r = 0; r < n; r++) { m.push([]); for (c = 0; c < n; c++) m[r].push(null); }
    function finder(r0, c0) { for (var a = -1; a <= 7; a++) for (var b = -1; b <= 7; b++) { var rr = r0 + a, cc = c0 + b; if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue; m[rr][cc] = (a >= 0 && a <= 6 && (b === 0 || b === 6)) || (b >= 0 && b <= 6 && (a === 0 || a === 6)) || (a >= 2 && a <= 4 && b >= 2 && b <= 4); } }
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    var al = ALIGN[v];
    for (var ai = 0; ai < al.length; ai++) for (var aj = 0; aj < al.length; aj++) { var ar = al[ai], ac = al[aj]; if (m[ar][ac] !== null) continue; for (var a2 = -2; a2 <= 2; a2++) for (var b2 = -2; b2 <= 2; b2++) m[ar + a2][ac + b2] = (a2 === -2 || a2 === 2 || b2 === -2 || b2 === 2 || (a2 === 0 && b2 === 0)); }
    for (k = 8; k < n - 8; k++) { if (m[6][k] === null) m[6][k] = k % 2 === 0; if (m[k][6] === null) m[k][6] = k % 2 === 0; }
    var reserved = m.map(function (row) { return row.map(function (x) { return x !== null; }); });
    // reserve format + version areas (filled in later)
    for (k = 0; k < 9; k++) { reserved[8][k] = true; reserved[k][8] = true; }
    for (k = 0; k < 8; k++) { reserved[8][n - 1 - k] = true; reserved[n - 1 - k][8] = true; }
    reserved[n - 8][8] = true;
    if (v >= 7) for (r = 0; r < 6; r++) for (c = 0; c < 3; c++) { reserved[r][n - 11 + c] = true; reserved[n - 11 + c][r] = true; }
    function build(mask) {
      var mm = m.map(function (row) { return row.slice(); });
      var inc = -1, row = n - 1, bit = 7, byte = 0, col, cc2;
      for (col = n - 1; col > 0; col -= 2) { if (col === 6) col--; while (true) { for (cc2 = 0; cc2 < 2; cc2++) { if (!reserved[row][col - cc2]) { var dk = false; if (byte < out.length) dk = ((out[byte] >>> bit) & 1) === 1; if (maskFn(mask, row, col - cc2)) dk = !dk; mm[row][col - cc2] = dk; bit--; if (bit === -1) { byte++; bit = 7; } } } row += inc; if (row < 0 || n <= row) { row -= inc; inc = -inc; break; } } }
      var data = (1 << 3) | mask, d = data << 10, fb = ((data << 10) | bch(d, 0x537)) ^ 0x5412, i2;
      for (i2 = 0; i2 < 15; i2++) { var md = ((fb >> i2) & 1) === 1;
        if (i2 < 6) mm[i2][8] = md; else if (i2 < 8) mm[i2 + 1][8] = md; else mm[n - 15 + i2][8] = md;
        if (i2 < 8) mm[8][n - i2 - 1] = md; else if (i2 < 9) mm[8][15 - i2] = md; else mm[8][15 - i2 - 1] = md; }
      mm[n - 8][8] = true;
      if (v >= 7) { var vb = (v << 12) | bch(v << 12, 0x1f25); for (i2 = 0; i2 < 18; i2++) { var mv = ((vb >> i2) & 1) === 1; mm[Math.floor(i2 / 3)][i2 % 3 + n - 11] = mv; mm[i2 % 3 + n - 11][Math.floor(i2 / 3)] = mv; } }
      return mm;
    }
    var best = null, bp = 1e9, mk;
    for (mk = 0; mk < 8; mk++) { var cand = build(mk), pn = penalty(cand, n); if (pn < bp) { bp = pn; best = cand; } }
    return { n: n, m: best, v: v };
  };
})();
