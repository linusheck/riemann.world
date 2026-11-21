import os, re, sys, json
src = sys.argv[1]; out = sys.argv[2]; subs = sys.argv[3:]
DECL = re.compile(r'^(?:@\[[^\]]*\]\s*)?(?:(?:private|protected|noncomputable|nonrec|partial|unsafe|scoped|local)\s+)*(theorem|lemma|def|abbrev|instance|structure|class|inductive|axiom|opaque)\b(?:\s+([^\s:({\[]+))?')
IMP = re.compile(r'^import\s+(\S+)')
KIND = {'theorem':0,'lemma':0,'def':1,'abbrev':1,'instance':2,'structure':3,'class':3,'inductive':3,'axiom':4,'opaque':4}
files = []
walks = [os.walk(os.path.join(src, x)) for x in subs] if subs else [os.walk(src)]
import itertools
for root, dirs, fs in itertools.chain(*walks):
    dirs.sort()
    for f in sorted(fs):
        if not f.endswith('.lean'): continue
        p = os.path.join(root, f)
        rel = os.path.relpath(p, src)
        mod = rel[:-5].replace(os.sep, '.')
        try:
            with open(p, encoding='utf-8', errors='replace') as fh:
                lines = fh.read().split('\n')
        except Exception as e:
            continue
        imps = []; kc = [0,0,0,0,0]; first = None; firstk = None
        for ln in lines:
            if ln.startswith('import '):
                m = IMP.match(ln)
                if m: imps.append(m.group(1))
                continue
            if not ln or ln[0] in ' \t-/': continue
            m = DECL.match(ln)
            if m:
                k = KIND[m.group(1)]; kc[k] += 1
                if first is None and m.group(2) and k in (0,1): first = m.group(2); firstk = k
        files.append([rel, mod, len(lines), kc, imps, first])
json.dump(files, open(out, 'w'), separators=(',',':'))
print(len(files), sum(sum(f[3]) for f in files))
