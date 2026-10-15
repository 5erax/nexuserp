const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const ids = (text) =>
  [...text.matchAll(/^\|\s*((?:IAM|INV|SAL|PUR|FIN)-\d{3})\s*\|/gm)].map((m) => m[1]);
const expected = ids(read('docs/product/SRS.md')).sort();
const actual = ['IAM', 'INVENTORY', 'SALES', 'PURCHASING', 'FINANCE']
  .flatMap((name) => ids(read(`docs/business-rules/${name}_RULES.md`)))
  .sort();
assert.equal(new Set(actual).size, actual.length, 'Rule IDs must have exactly one owner');
assert.deepEqual(actual, expected, 'Every SRS rule must have a rule table entry');
const stories = read('docs/product/USER_STORIES.md');
const issueIds = new Set([...stories.matchAll(/#(\d+)\b/g)].map((m) => Number(m[1])));
for (let issue = 32; issue <= 81; issue++)
  assert(issueIds.has(issue), `Issue #${issue} needs a user story`);
for (const name of ['IAM', 'INVENTORY', 'SALES', 'PURCHASING', 'FINANCE']) {
  for (const row of read(`docs/business-rules/${name}_RULES.md`)
    .split('\n')
    .filter((line) => /^\| (IAM|INV|SAL|PUR|FIN)-\d{3} \|/.test(line))) {
    assert(
      row.includes('planned:#') || /\.(?:integration-)?spec\.ts/.test(row),
      'Rule requires a planned or implemented test',
    );
  }
}
console.log(`Documentation traceability: ${actual.length} rules and 50 issues covered`);
