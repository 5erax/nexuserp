const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const files = [
  ['apps/web/messages/vi.json', '"brand": "NexusERP"', '"brand": "NexusERP Reload Probe"'],
  [
    'apps/api/src/modules/health/presentation/health.controller.ts',
    "status: 'ok' as const",
    "status: 'reload-probe' as const",
  ],
];
async function until(check, label) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await delay(500);
  }
  throw new Error('Hot reload timed out: ' + label);
}
async function main() {
  const originals = files.map(([path, from, to]) => {
    const original = fs.readFileSync(path, 'utf8');
    assert(original.includes(from), 'Probe must target an existing source expression');
    assert.notEqual(from, to);
    return original;
  });
  try {
    files.forEach(([path, from, to], index) =>
      fs.writeFileSync(path, originals[index].replace(from, to)),
    );
    await until(async () => {
      const response = await fetch('http://127.0.0.1:3000/');
      return response.ok && (await response.text()).includes('NexusERP Reload Probe');
    }, 'Next source bind mount');
    await until(async () => {
      const response = await fetch('http://127.0.0.1:3000/api/v1/health');
      return response.ok && (await response.json()).data.status === 'reload-probe';
    }, 'Nest watch through same-origin web proxy');
    console.log('Next and Nest reload live host edits without rebuilding containers');
  } finally {
    files.forEach(([path], index) => {
      fs.writeFileSync(path, originals[index]);
      assert.equal(fs.readFileSync(path, 'utf8'), originals[index]);
    });
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
