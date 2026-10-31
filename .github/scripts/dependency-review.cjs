'use strict';

// Compares two `npm audit --json` reports and fails only when the pull
// request introduces a new HIGH or CRITICAL advisory. Existing advisories in
// the base branch are ignored so this check can be required without freezing
// the repository on old dependency debt.

const fs = require('fs');

function readAudit(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`Could not read npm audit report at ${path}: ${error.message}`);
    process.exit(2);
  }
}

function collectAdvisories(audit) {
  const found = new Map();
  const vulnerabilities = audit.vulnerabilities || {};

  for (const [packageName, info] of Object.entries(vulnerabilities)) {
    if (info.severity !== 'high' && info.severity !== 'critical') {
      continue;
    }

    // A string entry in `via` means "vulnerable through this dependency".
    // The dependency itself has the advisory details, so only object entries
    // are collected here.
    const advisories = (info.via || []).filter(
      (via) => via && typeof via === 'object' && via.source !== undefined
    );

    for (const advisory of advisories) {
      const key = `${packageName}:${advisory.source}:${info.severity}`;
      if (!found.has(key)) {
        found.set(key, {
          package: packageName,
          severity: info.severity,
          title: advisory.title || 'Unknown advisory',
          url: advisory.url || '',
        });
      }
    }
  }

  return found;
}

const [basePath, headPath] = process.argv.slice(2);
if (!basePath || !headPath) {
  console.error('Usage: dependency-review.cjs <base-audit.json> <head-audit.json>');
  process.exit(2);
}

const base = collectAdvisories(readAudit(basePath));
const head = collectAdvisories(readAudit(headPath));
const added = [...head.entries()]
  .filter(([key]) => !base.has(key))
  .map(([, value]) => value);

if (added.length > 0) {
  console.error(`Found ${added.length} new high/critical advisory(ies):`);
  for (const item of added) {
    const link = item.url ? ` - ${item.url}` : '';
    console.error(`- ${item.package} (${item.severity}): ${item.title}${link}`);
  }
  process.exit(1);
}

console.log(
  `No new high/critical advisories (base: ${base.size}, head: ${head.size}).`
);
