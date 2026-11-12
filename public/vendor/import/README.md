# Local XLSX parser dependencies

Pinned packages from the official npm registry: fflate 0.8.3 (MIT), saxes 6.0.0 (ISC), xmlchars 2.2.0 (MIT).
`parser.js` is a browser ESM bundle produced by esbuild 0.25.12. Runtime is entirely local: no CDN, network, formula evaluation or macros.

The application's own `expense-import.js` uses streaming ZIP inflation with enforced actual output limits, then SAX parsing of a restricted OOXML spreadsheet subset. Unsupported types and workbook features fail explicitly. This is not a general Excel application.

See `scripts/import-vendor/` for the locked reproducible build and adjacent license files.
