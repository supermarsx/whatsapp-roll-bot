const fs = require('fs');
const path = require('path');

function getColor(pct) {
  if (pct >= 90) return '#4c1';
  if (pct >= 75) return '#a4c000';
  if (pct >= 50) return '#fe7d37';
  return '#e05d44';
}

function generateSvg(label, value, color) {
  // minimal flat badge SVG inspired by shields.io
  const leftWidth = 80;
  const rightWidth = 60;
  const height = 20;
  const totalWidth = leftWidth + rightWidth;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a">
    <rect width="${totalWidth}" height="${height}" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#a)">
    <rect width="${leftWidth}" height="${height}" fill="#555"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="${height}" fill="${color}"/>
    <rect width="${totalWidth}" height="${height}" fill="url(#b)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans, Verdana, Arial, sans-serif" font-size="11">
    <text x="${leftWidth / 2}" y="14">${label}</text>
    <text x="${leftWidth + rightWidth / 2}" y="14">${value}</text>
  </g>
</svg>`;
}

async function main() {
  try {
    const summaryPath = path.resolve(process.cwd(), 'coverage', 'coverage-summary.json');
    if (!fs.existsSync(summaryPath)) {
      console.error('coverage-summary.json not found at', summaryPath);
      process.exit(1);
    }
    const raw = fs.readFileSync(summaryPath, 'utf8');
    const obj = JSON.parse(raw);
    const pct = Math.round(obj.total.lines.pct || obj.total.statements.pct || 0);
    const color = getColor(pct);
    const svg = generateSvg('coverage', `${pct}%`, color);
    const badgesDir = path.resolve(process.cwd(), 'badges');
    if (!fs.existsSync(badgesDir)) fs.mkdirSync(badgesDir);
    fs.writeFileSync(path.join(badgesDir, 'coverage.svg'), svg, 'utf8');
    console.log('Wrote badges/coverage.svg with', pct, '%');
  } catch (e) {
    console.error('Failed to generate coverage badge:', e);
    process.exit(1);
  }
}

main();
