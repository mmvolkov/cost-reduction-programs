# Rebuild the vendored PDF module

This optional developer-only build does not run in the application, Docker runtime, or GitHub Pages. No production secret is needed.

From this directory, use Node 22+:

```
npm ci --ignore-scripts --no-audit --no-fund
./node_modules/.bin/esbuild entry.js --bundle --format=esm --platform=browser --minify --legal-comments=eof --outfile=../../public/vendor/report/jspdf.js
```

Pinned jsPDF 4.2.1 and esbuild 0.25.12 are locked in package-lock.json. Retain and review upstream licenses whenever updating. Test all export formats and render sample PDFs before publishing. Font modules are unchanged unless deliberately resubset from the licensed DejaVu originals.
