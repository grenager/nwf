// Rasterises the quill mark into the opaque PNGs iOS and Android need.
// Run once with `node gen-icons.mjs` from web/; the PNGs are committed, so
// sharp is not a runtime dependency.
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const QUILL = readFileSync("app/icon.svg", "utf8").match(
  /<path d="([^"]+)"/,
)[1];

// iOS composites any transparency onto black and applies its own rounded
// corner mask, so the tile is drawn opaque, square, and inset far enough
// that the mask never clips the mark.
const INSET = 0.64;
const OFFSET = (512 * (1 - INSET)) / 2;

const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#18181b"/>
  <g transform="translate(${OFFSET} ${OFFSET}) scale(${INSET})">
    <path d="${QUILL}" fill="#fafafa"/>
  </g>
</svg>`;

const targets = [
  ["app/apple-icon.png", 180],
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
];

for (const [path, size] of targets) {
  // flatten() drops the alpha channel outright rather than relying on iOS
  // to composite it the way we happen to want.
  const png = await sharp(Buffer.from(tile))
    .resize(size, size)
    .flatten({ background: "#18181b" })
    .png()
    .toBuffer();
  writeFileSync(path, png);
  console.log(`${path}  ${size}x${size}  ${png.length} bytes`);
}
