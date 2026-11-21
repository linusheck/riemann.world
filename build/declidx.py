import os, re, sys, json
src, outdir = sys.argv[1], sys.argv[2]
DECL = re.compile(r'^(?:@\[[^\]]*\]\s*)?(?:(?:private|protected|noncomputable|nonrec|partial|unsafe|scoped|local)\s+)*(?:theorem|lemma|def|abbrev|instance|structure|class|inductive|axiom|opaque)\b\s+([^\s:({\[]+)')
rows = []
for root, dirs, fs in os.walk(src):
    dirs.sort()
    for f in sorted(fs):
        if not f.endswith('.lean'): continue
        names = []
        with open(os.path.join(root, f), encoding='utf-8', errors='replace') as fh:
            for ln in fh:
                if not ln or ln[0] in ' \t-/\n': continue
                m = DECL.match(ln)
                if m: names.append(m.group(1))
        rows.append(' '.join(names))
# shard into ~10MB pieces; each shard: [startFileId, "line\nline..."]
shard, size, start, k = [], 0, 0, 0
def flush(start, shard, k):
    with open(os.path.join(outdir, f'decls{k}.js'), 'w') as o:
        o.write('(window.DECLIDX=window.DECLIDX||[]).push([%d,%s]);\n' % (start, json.dumps('\n'.join(shard))))
for i, r in enumerate(rows):
    shard.append(r); size += len(r) + 1
    if size > 10_000_000:
        flush(start, shard, k); k += 1; start = i + 1; shard, size = [], 0
if shard: flush(start, shard, k); k += 1
print(len(rows), 'files', k, 'shards', sum(len(r.split()) for r in rows), 'names')
