#!/usr/bin/env node
/**
 * Automated monthly release creator
 *
 * This script is intended to run (for example in CI) on the last day of the
 * month. It checks whether there have been commits in the current month; if
 * so it calculates the next release tag in the format `YY.N` (where `YY` is
 * the two-digit year and `N` is a sequential number for that year) and
 * creates a GitHub release with a body containing a short commit summary.
 *
 * Environment variables:
 * - GITHUB_REPOSITORY : owner/repo string required to target the repository
 * - GITHUB_TOKEN      : GitHub API token with permission to create releases
 *
 * Notes:
 * - The script only performs actions on the last day of the calendar month
 *   (it checks that tomorrow is the 1st).
 * - If there are no commits in the month the script exits without creating a
 *   release.
 * - The script uses the GitHub Releases API to list existing releases and
 *   create a new release.
 *
 * Usage: node scripts/monthly-release.js
 *
 * @module scripts/monthly-release
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Main entrypoint for the release script.
 *
 * The function performs these steps:
 * 1. Verify the current day is the last day of the month (tomorrow is day 1).
 * 2. Count commits since the first day of the month using `git rev-list`.
 * 3. If commits exist, fetch existing GitHub releases for the repository and
 *    compute the next sequential `YY.N` tag for the year.
 * 4. Prepare a release body summarizing commits for the month and create the
 *    release via the GitHub Releases API.
 *
 * The function logs progress to stdout/stderr and returns an exit code number
 * indicating success (0) or failure (non-zero). The script will call
 * process.exit with the returned code when the promise resolves.
 *
 * @async
 * @returns {Promise<number>} Exit code (0 on success, non-zero on error)
 */
async function main() {
  try {
    // Only run on last day of month
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (tomorrow.getDate() !== 1) {
      console.log('Not the last day of month; skipping');
      return 0;
    }

    // Check if there were commits since start of month
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const since = `${year}-${month}-01`;
    let count = 0;
    try {
      const out = execSync(`git rev-list --count --first-parent --since="${since}" HEAD`, {
        encoding: 'utf8',
      }).trim();
      count = Number(out) || 0;
    } catch (e) {
      console.error('Failed to count commits:', e && e.message);
      return 1;
    }
    if (count === 0) {
      console.log('No commits in this month; skipping release');
      return 0;
    }

    const repoFull = process.env.GITHUB_REPOSITORY;
    if (!repoFull) {
      console.error('GITHUB_REPOSITORY not set; cannot create release');
      return 1;
    }
    const [owner, repo] = repoFull.split('/');

    const yy = String(year).slice(-2);

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.error('GITHUB_TOKEN not set; exiting');
      return 1;
    }

    // list releases
    const releasesRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!releasesRes.ok) {
      console.error('Failed to fetch releases:', releasesRes.status, await releasesRes.text());
      return 1;
    }
    const releases = await releasesRes.json();

    // find releases for this year matching YY.N
    const re = new RegExp(`^${yy}\\.(\\d+)$`);
    let maxN = 0;
    for (const r of releases) {
      const tag = (r.tag_name || '').trim();
      const m = tag.match(re);
      if (m) {
        const n = Number(m[1]);
        if (!Number.isNaN(n) && n > maxN) maxN = n;
      }
    }
    const next = maxN + 1;
    const tagName = `${yy}.${next}`;
    const releaseName = `Release ${tagName}`;

    // prepare body: include commit summary for the month
    let commits = '';
    try {
      commits = execSync(`git log --since="${since}" --pretty=format:"- %h %s (%an)" --no-merges`, {
        encoding: 'utf8',
      }).trim();
    } catch (e) {
      commits = '';
    }
    const body = `Automated monthly release for ${year}-${month}\n\nCommits this month:\n${commits}`;

    // create tag + release via API
    const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
      body: JSON.stringify({
        tag_name: tagName,
        name: releaseName,
        body,
        draft: false,
        prerelease: false,
      }),
    });
    if (!createRes.ok) {
      console.error('Failed to create release:', createRes.status, await createRes.text());
      return 1;
    }
    const created = await createRes.json();
    console.log('Created release:', created.html_url);
    return 0;
  } catch (e) {
    console.error('monthly-release failed:', e && e.message);
    return 1;
  }
}

/**
 * Ensure `fetch` is available on older Node runtimes by dynamically
 * importing `node-fetch` when necessary. On Node 18+ this is a no-op.
 *
 * This small compatibility shim returns a Promise-based fetch and is used
 * by the script above to perform GitHub API calls.
 */
// Node 18+ has global fetch; ensure we have it
if (typeof fetch === 'undefined') {
  global.fetch = (...args) => import('node-fetch').then(m => m.default(...args));
}

main().then(code => process.exit(code));
