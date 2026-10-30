# Documentation assets

## `roi-browser.jpg`

This is an illustrative capture of the existing PelagiaView demo workspace at `/analysis/rois`, captured 2026-10-30. It shows the candidate gallery and selected ROI inspector with the display inverted. The scale bar is in pixels only; it makes no physical-calibration claim.

The capture used cached demo UI state while the API was unavailable. It excludes browser chrome and the application status footer. It is an illustrative UI capture and makes no live-availability or performance claim. No semantic retouching was applied; the application region was resized to 1800 pixels and saved as JPEG.

To refresh it, use the demo data and the same route, select an ROI, verify that no credentials or machine-specific paths are visible, and capture only the application region. Do not use raw full-window screenshots.

## README logo wrapper

`readme-logo.svg` is a self-contained presentation wrapper around the original `static/brand/pelagia_logo.png`, with a white rounded-rectangle backing for dark-theme contrast. It embeds the original artwork without recoloring or redrawing it. Regenerate the wrapper if the source logo changes.

The committed `readme-logo.png` derivative is rendered from that wrapper. To regenerate it without adding repository dependencies:

Run this from the PelagiaView repository root:

```bash
npm install --prefix "${TMPDIR:-/tmp}/pelagia-doc-assets" --no-save --no-audit --no-fund @resvg/resvg-js
NODE_PATH="${TMPDIR:-/tmp}/pelagia-doc-assets/node_modules" node <<'JS'
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const svg = 'docs/assets/readme-logo.svg';
fs.writeFileSync('docs/assets/readme-logo.png', new Resvg(fs.readFileSync(svg, 'utf8')).render().asPng());
JS
```

The wrapper embeds the original artwork as base64; edit or regenerate that wrapper from the original logo when the source logo changes, then render the PNG derivative.

