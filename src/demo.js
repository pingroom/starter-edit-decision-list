import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson } from './storage.js';
import { step, exportTimeline } from './engine.js';
import { mapTimelineFrame } from './model.js';
import { mockApi, CONFIG, ROOM_CODE } from './mock.js';

const input = await readJson(new URL('../examples/edit.json', import.meta.url), 65536);
for (const [scenario, choices] of [['short-cut', ['b', 'b']], ['alternate-cut', ['a', 'c']], ['unknown', ['a', 'unknown']]]) {
  const directory = await mkdtemp(join(tmpdir(), 'pingroom-edit-demo-'));
  try {
    const now = () => '2026-01-01T09:00:00.000Z', api = mockApi(now);
    const options = { client: api.client, directory, input, config: CONFIG, token: 'offline-fixture-token', room: ROOM_CODE, now };
    let result;
    for (const choice of choices) {
      const pending = await step(options), question = pending.answers.find(answer => answer.status === 'pending');
      api.answer(question.questionId, choice); result = await step(options);
    }
    assert.equal(api.calls.filter(call => call.method === 'POST').length, 2);
    if (scenario === 'unknown') {
      assert.equal(result.status, 'unknown'); assert.equal(result.timeline, null); await assert.rejects(exportTimeline(directory, input));
    } else {
      assert.equal(result.status, 'complete'); await exportTimeline(directory, input);
      assert.equal(result.timeline.totalFrames, scenario === 'short-cut' ? 144 : 240);
      const selected = Object.fromEntries(input.scenes.map((scene, index) => [scene.id, choices[index]]));
      const firstAfterCut = mapTimelineFrame(input, selected, result.timeline.cuts[0].timelineOut);
      assert.equal(firstAfterCut.sceneId, 'detail'); assert.equal(firstAfterCut.sourceFrame, scenario === 'short-cut' ? 900 : 960);
    }
    console.log(JSON.stringify({ scenario, transport: 'local mock through the real SDK; no live delivery', status: result.status, timeline: result.timeline }, null, 2));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
