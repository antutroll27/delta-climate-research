import test from 'node:test';
import assert from 'node:assert/strict';

const { createPairedScenarioClient } = await import('../../src/scripts/climate-engine/compare/paired-client.ts');

class FakeWorker {
  messages = [];
  listeners = { message: new Set(), error: new Set() };
  postMessage(message) { this.messages.push(message); }
  addEventListener(type, listener) { this.listeners[type].add(listener); }
  removeEventListener(type, listener) { this.listeners[type].delete(listener); }
  terminate() { this.terminated = true; }
  emit(type, data) { for (const listener of this.listeners[type]) listener({ data }); }
}

const state = {
  a: 'in/kolkata/ballygunge', b: 'in/kolkata/baruipur', forcing: 'illustrative', phase: 'peak',
  coverage: { trees: 0, roofs: 0, parks: 0, facades: 0 },
};

test('paired client sends cancellation for an aborted worker request', async () => {
  const worker = new FakeWorker();
  const client = createPairedScenarioClient({ workerFactory: () => worker });
  const controller = new AbortController();
  const pending = client.run(state, { signal: controller.signal });
  controller.abort();
  assert.equal(worker.messages[0].type, 'run');
  assert.deepEqual(worker.messages[1], { type: 'cancel', requestId: 1 });
  worker.emit('message', { type: 'cancelled', requestId: 1 });
  await assert.rejects(pending, (error) => error.name === 'AbortError');
  client.dispose();
});
