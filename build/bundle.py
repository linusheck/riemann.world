"""Pack the Lean source into gzip bundles for static hosting.
plan:  python3 bundle.py plan SRC OUTDIR          -> OUTDIR/plan.json + OUTDIR/index.js
pack:  python3 bundle.py pack SRC OUTDIR A B      -> bundles A..B-1 (OUTDIR/bNNN.bin)
Each bundle is gzip(JSON [[fileId, text], ...]); file ids follow the same sorted walk as extract.py."""
import os, sys, json, gzip
from multiprocessing import Pool
TARGET = 6_000_000
def walk(src):
    out = []
    for root, dirs, fs in os.walk(src):
        dirs.sort()
        for f in sorted(fs):
            if f.endswith('.lean'): out.append(os.path.join(root, f))
    return out
def plan(src, outdir):
    files = walk(src); starts = [0]; size = 0
    for i, p in enumerate(files):
        s = os.path.getsize(p)
        if size and size + s > TARGET: starts.append(i); size = 0
        size += s
    os.makedirs(outdir, exist_ok=True)
    json.dump({'files': [os.path.relpath(p, src) for p in files], 'starts': starts}, open(os.path.join(outdir, 'plan.json'), 'w'))
    open(os.path.join(outdir, 'index.js'), 'w').write('window.SRCBUNDLES=%s;\n' % json.dumps(starts))
    print(len(files), 'files', len(starts), 'bundles')
def one(args):
    src, outdir, k, a, b, rels = args
    rows = []
    for i in range(a, b):
        with open(os.path.join(src, rels[i - a]), encoding='utf-8', errors='replace') as fh: rows.append([i, fh.read()])
    data = gzip.compress(json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode('utf-8'), compresslevel=6, mtime=0)
    open(os.path.join(outdir, 'b%03d.bin' % k), 'wb').write(data)
    return len(data)
def pack(src, outdir, A, B):
    P = json.load(open(os.path.join(outdir, 'plan.json')))
    st = P['starts'] + [len(P['files'])]
    jobs = [(src, outdir, k, st[k], st[k + 1], P['files'][st[k]:st[k + 1]]) for k in range(A, min(B, len(st) - 1))]
    with Pool(4) as pool: sizes = pool.map(one, jobs)
    print('packed', len(sizes), 'bundles', sum(sizes) // 1_000_000, 'MB')
if __name__ == '__main__':
    if sys.argv[1] == 'plan': plan(sys.argv[2], sys.argv[3])
    else: pack(sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]))
