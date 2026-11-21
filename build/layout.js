// Tiled build: circle-pack layout, then split into a small skeleton (all folders)
// plus spatial "tiles" of files that the viewer fetches on demand.
// usage: node build/layout.js build/raw.json build/decls0.js,build/decls1.js OUTDIR
const fs = require('fs');
const path = require('path');
const { hierarchy, pack } = require('d3-hierarchy');
const [, , rawPath, declPaths, OUT] = process.argv;
const CH = 1500;          // max files per tile
const SEARCH_SHARD = 4e6; // bytes per search shard

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const F = raw.length;
const modIndex = new Map(raw.map((f, i) => [f[1], i]));

// ---------- import graph ----------
const imp = raw.map(f => f[4].map(m => modIndex.get(m)).filter(j => j !== undefined));
const ext = raw.map((f, i) => f[4].length - imp[i].length);
const rimp = Array.from({ length: F }, () => []);
imp.forEach((o, i) => o.forEach(j => rimp[j].push(i)));
const depth = new Int32Array(F).fill(-1);
const MAINF = modIndex.get('Main');
{ const q = [MAINF]; depth[MAINF] = 0;
  for (let h = 0; h < q.length; h++) for (const j of imp[q[h]]) if (depth[j] < 0) { depth[j] = depth[q[h]] + 1; q.push(j); } }
const maxDepth = depth.reduce((a, b) => Math.max(a, b), 0);
const chain = new Int32Array(F).fill(-1);
for (let f = 0; f < F; f++) if (depth[f] > 0) { const g = rimp[f].find(h => depth[h] === depth[f] - 1); if (g !== undefined) chain[f] = g; }
const indeg = rimp.map(r => r.length);
const maxIndeg = indeg.reduce((a, b) => Math.max(a, b), 0);
// rank-based colour position for depth: midpoint of each depth's share of files (histogram equalisation)
const hist = new Array(maxDepth + 1).fill(0); for (const d of depth) if (d >= 0) hist[d]++;
const depthT = []; { let acc = 0; for (let d = 0; d <= maxDepth; d++) { depthT.push((acc + hist[d] / 2) / F); acc += hist[d]; } }
// same for log in-degree (many files have 0 or 1 importer)
const indegVals = indeg.map(v => Math.log1p(v));

// ---------- hierarchy + pack (same as before) ----------
const root = { name: 'src', children: [], kids: new Map() };
raw.forEach((f, i) => {
  const parts = f[0].split('/'); let node = root;
  for (let k = 0; k < parts.length - 1; k++) {
    let c = node.kids.get(parts[k]);
    if (!c) { c = { name: parts[k], children: [], kids: new Map() }; node.kids.set(parts[k], c); node.children.push(c); }
    node = c;
  }
  node.children.push({ name: parts[parts.length - 1].replace(/\.lean$/, ''), file: i });
});
const h = hierarchy(root, d => d.children).sum(d => (d.file !== undefined ? Math.max(raw[d.file][2], 5) : 0)).sort((a, b) => b.value - a.value);
const R = 1e6;
pack().radius(d => Math.sqrt(d.value)).padding(n => {
  let s = 0; for (const c of n.children) s += c.r * c.r;
  return 0.06 * Math.sqrt(s) / Math.sqrt(1 + 0.15 * n.children.length) + 0.12 * Math.sqrt(s) / n.children.length;
})(h);
{ const k = R / h.r, cx = h.x, cy = h.y; h.each(n => { n.x = (n.x - cx) * k; n.y = (n.y - cy) * k; n.r *= k; }); }

// ---------- folders (skeleton), preorder over directories only ----------
const dirs = [];
h.eachBefore(n => { if (n.children) { n.did = dirs.length; dirs.push(n); } });
const D = dirs.length;
// per-dir aggregates
h.eachAfter(n => {
  if (!n.children) {
    const f = n.data.file, k = raw[f][3];
    n.agg = { files: 1, lines: raw[f][2], decls: k.reduce((a, b) => a + b, 0), thm: k[0], dsum: depth[f], isum: indegVals[f], dirs: 0 };
  } else {
    const a = { files: 0, lines: 0, decls: 0, thm: 0, dsum: 0, isum: 0, dirs: 1 };
    for (const c of n.children) for (const key in a) a[key] += c.agg[key];
    n.agg = a;
  }
});

// ---------- tiles ----------
function hilbert(x, y) { // x,y in [0, 65535]
  const n = 65536; let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = n - 1 - x; y = n - 1 - y; } const t = x; x = y; y = t; }
  }
  return d;
}
const filesUnder = n => { const out = []; n.each(m => { if (!m.children) out.push(m); }); return out; };
const tiles = [];
function chunkify(n) {
  if (n.agg.files <= CH) { tiles.push(filesUnder(n)); return; }
  const items = [];
  for (const c of n.children) {
    if (!c.children) items.push({ c, w: 1 });
    else if (c.agg.files <= CH) items.push({ c, w: c.agg.files });
    else chunkify(c);
  }
  if (!items.length) return;
  const x0 = n.x - n.r, s = 65535 / (2 * n.r);
  items.forEach(it => { it.h = hilbert(Math.round((it.c.x - x0) * s), Math.round((it.c.y - (n.y - n.r)) * s)); });
  items.sort((a, b) => a.h - b.h);
  let bin = [], w = 0;
  const flush = () => { if (bin.length) tiles.push(bin.flatMap(it => it.c.children ? filesUnder(it.c) : [it.c])); bin = []; w = 0; };
  for (const it of items) { if (w + it.w > CH) flush(); bin.push(it); w += it.w; }
  flush();
}
chunkify(h);
// file node ids: D + position in tile order
let nid = D;
const nodeOfFile = new Int32Array(F);
tiles.forEach(t => t.forEach(m => { m.nid = nid++; nodeOfFile[m.data.file] = m.nid; }));
const N = nid;

// ---------- write ----------
fs.mkdirSync(path.join(OUT, 'map'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'search'), { recursive: true });
const r1 = v => Math.round(v * 10) / 10;
const tileOfDir = Array.from({ length: D }, () => new Set());
const tileMeta = tiles.map((t, c) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, mr = 0;
  for (const m of t) { x0 = Math.min(x0, m.x - m.r); y0 = Math.min(y0, m.y - m.r); x1 = Math.max(x1, m.x + m.r); y1 = Math.max(y1, m.y + m.r); mr = Math.max(mr, m.r); tileOfDir[m.parent.did].add(c); }
  return [t[0].nid, t.length, Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1), r1(mr)];
});
let tileBytes = 0;
tiles.forEach((t, c) => {
  const o = {
    par: t.map(m => m.parent.did), x: t.map(m => Math.round(m.x)), y: t.map(m => Math.round(m.y)), r: t.map(m => r1(m.r)),
    name: t.map(m => m.data.name), fid: t.map(m => m.data.file), lines: t.map(m => raw[m.data.file][2]),
    kinds: t.flatMap(m => raw[m.data.file][3]), depth: t.map(m => depth[m.data.file]), indeg: t.map(m => indeg[m.data.file]),
    ext: t.map(m => ext[m.data.file]), nimp: t.map(m => imp[m.data.file].length),
  };
  const s = JSON.stringify(o); tileBytes += s.length;
  fs.writeFileSync(path.join(OUT, 'map', `t${String(c).padStart(4, '0')}.json`), s);
  // import edges live in a separate file, fetched only when a file in this tile is selected
  const e = {
    imp: t.map(m => imp[m.data.file].map(g => nodeOfFile[g])), rimp: t.map(m => rimp[m.data.file].map(g => nodeOfFile[g])),
    chain: t.map(m => (chain[m.data.file] >= 0 ? nodeOfFile[chain[m.data.file]] : -1)),
  };
  fs.writeFileSync(path.join(OUT, 'map', `e${String(c).padStart(4, '0')}.json`), JSON.stringify(e));
});
const skel = {
  N, D, F, R, maxDepth, maxIndeg, depthT, mainNode: nodeOfFile[MAINF],
  dir: {
    par: dirs.map(n => (n.parent ? n.parent.did : -1)), x: dirs.map(n => Math.round(n.x)), y: dirs.map(n => Math.round(n.y)), r: dirs.map(n => r1(n.r)),
    name: dirs.map(n => n.data.name), size: dirs.map(n => n.agg.dirs), files: dirs.map(n => n.agg.files), lines: dirs.map(n => n.agg.lines),
    decls: dirs.map(n => n.agg.decls), thm: dirs.map(n => n.agg.thm),
    depth: dirs.map(n => r1(n.agg.dsum / n.agg.files)), lindeg: dirs.map(n => Math.round(n.agg.isum / n.agg.files * 100) / 100),
    nkids: dirs.map(n => n.children.length),
    tiles: tileOfDir.map(s => [...s]),
  },
  tiles: tileMeta,
};
const skelS = JSON.stringify(skel);
fs.writeFileSync(path.join(OUT, 'map', 'skeleton.json'), skelS);

// search index: "nodeId\tdirId\tfileName\tdecl decl ..." per file, sharded
const declLines = [];
for (const p of declPaths.split(',')) {
  const txt = fs.readFileSync(p, 'utf8'); const a = txt.indexOf('.push(') + 6; const arr = JSON.parse(txt.slice(a, txt.lastIndexOf(')')));
  const [start, text] = arr; text.split('\n').forEach((l, i) => { declLines[start + i] = l; });
}
const modPath = m => { const parts = []; let n = m; while (n.parent) { parts.push(n.data.name); n = n.parent; } return parts.reverse().join('.'); };
const lines = [];
tiles.forEach(t => t.forEach(m => lines.push(`${m.nid}\t${m.parent.did}\t${m.data.name}\t${declLines[m.data.file] || ''}`)));
let shard = [], sz = 0, k = 0;
const flushS = () => { fs.writeFileSync(path.join(OUT, 'search', `s${k}.txt`), shard.join('\n')); k++; shard = []; sz = 0; };
for (const l of lines) { shard.push(l); sz += l.length + 1; if (sz > SEARCH_SHARD) flushS(); }
if (shard.length) flushS();
skel.searchShards = k;
fs.writeFileSync(path.join(OUT, 'map', 'skeleton.json'), JSON.stringify(skel));
console.error(`dirs ${D} files ${F} tiles ${tiles.length} (max ${tiles.reduce((a, t) => Math.max(a, t.length), 0)}, min ${tiles.reduce((a, t) => Math.min(a, t.length), 1e9)})`);
console.error(`skeleton ${(skelS.length / 1e6).toFixed(2)} MB, tiles total ${(tileBytes / 1e6).toFixed(1)} MB, search shards ${k}`);
