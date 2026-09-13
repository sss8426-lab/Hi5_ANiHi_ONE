# Browser ZIP Dependency

`fflate-0.8.3.js` is the unmodified ESM browser distribution of fflate 0.8.3
(`esm/browser.js`). The MIT license is included in `FFLATE-LICENSE.txt`.

- Source: https://github.com/101arrowz/fflate/tree/v0.8.3
- Existing locked dependency: `fast-png@8.0.0` -> `fflate@0.8.3`.
- Upstream LF file SHA-256: `B7CA4450B19559A1D50EB381ADCEE94B82449674BE4CD17789D9BEBA7E6122A1`.
- Served same-origin. No CDN, telemetry, network requests or runtime install.
- Used only when opening the attendance workbook tool. XLSX XML is handled by
  browser DOMParser/XMLSerializer; ZIP compression is not a home-grown parser.
- Excluded from application-style ESLint rules as vendored code; `node --check`
  and the attendance tests still cover the module.

When upgrading, replace the complete upstream file and license together, update
the versioned import and validate the workbook/PDF regression fixtures.
