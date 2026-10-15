const assert = require('node:assert/strict');
async function main() {
  const blocked = process.argv[2] === 'blocked';
  assert(blocked || process.argv[2] === 'fresh');
  const count = blocked ? 21 : 1;
  for (let index = 1; index <= count; index++) {
    const response = await fetch('http://edge:8080/api/v1/health', {
      headers: { 'X-Forwarded-For': '198.51.100.' + index },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, blocked && index === 21 ? 429 : 200);
  }
  if (blocked) {
    const direct = await fetch('http://api:3001/api/v1/health', {
      headers: { 'X-Forwarded-For': '203.0.113.99' },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(direct.status, 429, 'A direct client must not spoof its way out of its quota');
  }
  console.log(
    blocked
      ? 'Proxy quota enforced despite forged headers'
      : 'A second client retains its own quota',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
