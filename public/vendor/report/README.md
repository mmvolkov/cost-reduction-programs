# Offline report PDF dependencies

jsPDF 4.2.1 (MIT), bundled as browser ESM with esbuild 0.25.12. Installed from the official npm registry with lifecycle scripts disabled. npm audit of this pinned dependency tree on 2026-11-12 reported zero advisories.

The bundled library is loaded only for PDF export. This application uses text/font/page APIs only; it does not invoke HTML, image, URL, file-loading, or script APIs. No runtime CDN or external service is used. The additional license file includes the complete pinned build dependency tree, including build-only packages.

Source: https://github.com/parallax/jsPDF/releases/tag/v4.2.1
Rebuild instructions and pinned lockfile: scripts/report-vendor/README.md.

Font modules are licensed DejaVu Sans subsets, see ../../fonts/report/LICENSE.txt. They cover Latin/Cyrillic, general punctuation, currency signs including ₽, and arrows. A subset is embedded in every exported PDF so Russian text remains selectable and searchable.
