# riemann.world

A zoomable nested-circle map of a 175,187-file Lean 4 project (≈17M lines, ≈1.06M declarations). It is a plain static site with no build step, so it works on GitHub Pages or any static file server.

## What's in here

| Path | What | Loaded |
|---|---|---|
| `index.html` | the viewer (no framework, canvas rendering) | at start |
| `map/skeleton.json` | all 3,615 folders: layout, totals, colour stats, tile table | at start (~100 KB gz) |
| `map/tNNNN.json` | 150 tiles of up to 1,500 neighbouring files: position, name, stats | when in view (~30 KB gz each) |
| `map/eNNNN.json` | each tile's import edges + the chain back to `Main` | when one of its files is selected |
| `search/sK.txt` | search index: file and declaration names | on first search |
| `src/bNNN.bin` | the Lean source, 173 gzip bundles (JSON `[[fileId, text], …]`) | when a file's source is needed |
| `src/index.js` | first file id of each source bundle | at start |
| `d3-hierarchy.min.js` | d3-hierarchy v3 (ISC licence), packs the declaration circles | at start |
| `build/` | the scripts that generated all of the above | — |
| `.nojekyll` | tells GitHub Pages to serve files as-is | — |

## Regenerating

All the data comes from reading the source text with regexes (no Lean build needed). From this folder, with the Lean project at `SRC`:

```bash
SRC=../lean/lean/src
python3 build/extract.py $SRC build/raw.json          # per-file stats + imports (~110 MB, git-ignored)
python3 build/declidx.py $SRC build                   # declaration names -> build/decls*.js (git-ignored)
python3 build/bundle.py plan $SRC src && python3 build/bundle.py pack $SRC src 0 999
npm i d3-hierarchy@3 && node build/layout.js build/raw.json build/decls0.js,build/decls1.js .   # map/ + search/
```

Because the data comes from regexes over the source text, declarations produced by unusual formatting or by macros can be missed, and import counts cover only this project, not Mathlib.
