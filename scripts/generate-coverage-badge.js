/**
 * Coverage badge generator script
 *
 * This small script reads the Istanbul/nyc coverage summary produced by
 * many test runners at `coverage/coverage-summary.json`, extracts the
 * coverage percentage (preferring lines, then statements), and writes a
 * minimal SVG badge to `badges/coverage.svg`.
 *
 * The generated SVG is a simple flat badge inspired by shields.io and is
 * intended to be used in README files or CI artifact pages.
 *
 * Usage: node scripts/generate-coverage-badge.js
 *
 * @module scripts/generate-coverage-badge
 */

const fs = require('fs');
const path = require('path');

/**
 * Choose a color hex for a given coverage percentage.
 *
 * @param {number} pct - Coverage percentage (0-100)
 * @returns {string} Hex color string to use for badge right-hand panel.
 */
function getColor(pct) {
  if (pct >= 90) return '#4c1';
  if (pct >= 75) return '#a4c000';
  if (pct >= 50) return '#fe7d37';
  return '#e05d44';
}

/**
 * Generate a minimal SVG badge string.
 *
 * The badge layout is intentionally simple: a fixed left label area and a
 * right value area. The function returns a complete SVG document string.
 *
 * @param {string} label - Left-hand label text (e.g. 'coverage').
 * @param {string} value - Right-hand value text (e.g. '85%').
 * @param {string} color - Hex color for the right-hand panel.
 * @returns {string} SVG markup.
 */
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

/**
 * Main program: read coverage summary, compute percentage, generate SVG and write it.
 * Exits the process with non-zero code on failure.
 *
 * @returns {Promise<void>} Resolves when badge generation completes or exits the process on error.
 */
async function main() {
  try {
    const summaryPath = path.resolve(process.cwd(), 'coverage', 'coverage-summary.json');

    // Primary: try the json-summary produced by Istanbul/nyc
    let pct = 0;
    if (fs.existsSync(summaryPath)) {
      const raw = fs.readFileSync(summaryPath, 'utf8');
      const obj = JSON.parse(raw);
      pct = Math.round(obj.total.lines.pct || obj.total.statements.pct || 0);
    } else {
      // Fallback 1: parse LCOV produced by Jest/nyc
      const lcovPath = path.resolve(process.cwd(), 'coverage', 'lcov.info');
      if (fs.existsSync(lcovPath)) {
        const lcov = fs.readFileSync(lcovPath, 'utf8');
        const lfMatches = lcov.match(/^LF:(\d+)$/gm) || [];
        const lhMatches = lcov.match(/^LH:(\d+)$/gm) || [];
        if (lfMatches.length && lhMatches.length) {
          const totalLF = lfMatches.reduce((acc, line) => acc + Number(line.split(':')[1]), 0);
          const totalLH = lhMatches.reduce((acc, line) => acc + Number(line.split(':')[1]), 0);
          pct = totalLF > 0 ? Math.round((totalLH / totalLF) * 100) : 0;
        } else {
          // Fallback 2: parse coverage-final.json and compute from per-file statement counts
          const finalPath = path.resolve(process.cwd(), 'coverage', 'coverage-final.json');
          if (fs.existsSync(finalPath)) {
            const finalRaw = fs.readFileSync(finalPath, 'utf8');
            const finalObj = JSON.parse(finalRaw);
            let total = 0;
            let covered = 0;
            for (const key of Object.keys(finalObj)) {
              const f = finalObj[key];
              if (
                f &&
                f.lines &&
                typeof f.lines.total === 'number' &&
                typeof f.lines.covered === 'number'
              ) {
                total += f.lines.total;
                covered += f.lines.covered;
              } else if (f && f.s) {
                const stmtKeys = Object.keys(f.s || {});
                total += stmtKeys.length;
                covered += stmtKeys.filter(k => f.s[k] > 0).length;
              } else if (f && f.statementMap) {
                const stmtKeys = Object.keys(f.statementMap || {});
                total += stmtKeys.length;
                if (f.s) covered += Object.keys(f.s).filter(k => f.s[k] > 0).length;
              }
            }
            pct = total > 0 ? Math.round((covered / total) * 100) : 0;
          } else {
            console.error('coverage-summary.json not found at', summaryPath);
            process.exit(1);
          }
        }
      } else {
        // No coverage artifacts found
        console.error('coverage-summary.json not found at', summaryPath);
        process.exit(1);
      }
    }

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
