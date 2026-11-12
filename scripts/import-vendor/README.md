# Rebuild local import dependencies

Run in this directory with Node 22+:

```sh
npm ci --ignore-scripts
node node_modules/esbuild/bin/esbuild entry.js --bundle --platform=browser --format=esm --target=es2022 --minify --outfile=../../public/vendor/import/parser.js
```

Review npm audit and licenses before changing versions. Do not bundle arbitrary new packages. No npm install is required to use the site or run its ordinary tests.
