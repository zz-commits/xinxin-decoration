const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { fakeDB } = require('./helpers.cjs');

function worker(options = {}) {
  const db = fakeDB({
    generation_locks: [{ _id: 'image-worker', runId: '', lockedUntil: options.locked ? '2099-01-01T00:00:00.000Z' : '' }],
    projects: [{ _id: 'project-1', generationActive: true, status: 'generating' }],
    generation_jobs: [{ _id: 'job-1', projectId: 'project-1', locationId: 'balcony', angle: '正面整体', createdBy: 'engineer', requirementsHash: 'hash-1', createdAt: '2026-01-01', status: 'queued', attempts: 0 }],
  });
  const calls = [];
  const normalCollection = db.collection;
  if (options.projectUpdateFails) {
    db.collection = name => {
      const collection = normalCollection(name);
      if (name === 'projects') {
        const normalDoc = collection.doc;
        collection.doc = id => ({ ...normalDoc(id), async update() { throw new Error('PROJECT_STATUS_UNAVAILABLE'); } });
      }
      return collection;
    };
  }
  const exports = {};
  const cloud = {
    init() {}, database: () => db, getWXContext: () => options.client ? { OPENID: 'visitor', APPID: 'app' } : {},
    ai() { throw new Error('PREFLIGHT_MUST_NOT_CALL_AI'); },
    async uploadFile(value) { calls.push(['upload', value.cloudPath]); return { fileID: 'cloud://env/private/render.jpg' }; },
  };
  vm.runInNewContext(fs.readFileSync('cloudfunctions/generation-worker/index.js', 'utf8'), {
    exports, console: { error() {} }, process: { env: options.disabled ? {} : { GENERATION_MODE: options.mode || 'scheduled' }, versions: { node: '20.19.0' } },
    require(name) {
      if (name === 'node:crypto') return crypto;
      if (name === 'wx-server-sdk') return cloud;
      if (name === 'wx-server-sdk/package.json') return { version: '4.0.2' };
      if (name === './provider') return { async generate(_cloud, job) {
        calls.push(['generate', job._id]);
        if (options.providerFails) throw new Error('MODEL_UNAVAILABLE');
        return { buffer: Buffer.from('stub'), extension: 'jpg', prompt: 'stub', revisedPrompt: '', provider: 'test-only' };
      } };
      throw new Error(name);
    },
  });
  return { main: (event = { Type: 'Timer', TriggerName: 'image-queue' }) => exports.main(event), db, calls };
}

test('Worker 默认暂停，预检不调用模型、不获取锁或改变任务', async () => {
  const { main, db, calls } = worker({ disabled: true });
  const before = JSON.stringify(db.data);
  assert.equal((await main()).code, 'GENERATION_PAUSED');
  const result = await main({ action: 'preflight' });
  assert.equal(result.paidCall, false);
  assert.equal(result.mode, 'disabled');
  assert.equal(result.sdkVersion, '4.0.2');
  assert.equal(result.aiAvailable, true);
  assert.equal(JSON.stringify(db.data), before);
  assert.equal(calls.length, 0);
  assert.equal((await worker({ client: true, disabled: true }).main({ action: 'preflight' })).code, 'INTERNAL_ONLY');
});

test('手动模式必须指定任务，定时事件和空请求不能触发生图', async () => {
  const { main, calls, db } = worker({ mode: 'manual' });
  for (const event of [{}, { Type: 'Timer', TriggerName: 'image-queue' }, { action: 'runOne' }, { action: 'runOne', jobId: '../bad' }]) assert.equal((await main(event)).code, 'EXPLICIT_JOB_REQUIRED');
  assert.equal(calls.length, 0);
  assert.equal(db.data.generation_locks[0].runId, '');
});

test('手动模式只处理指定的 queued 任务，不顺带执行其他任务，也不自动重试', async () => {
  const { main, calls, db } = worker({ mode: 'manual' });
  await db.collection('generation_jobs').add({ data: { ...db.data.generation_jobs[0], _id: 'job-2', createdAt: '2026-02-01' } });
  assert.equal((await main({ action: 'runOne', jobId: 'job-2' })).ok, true);
  assert.equal(db.data.generation_jobs.find(row => row._id === 'job-1').status, 'queued');
  assert.equal(db.data.generation_jobs.find(row => row._id === 'job-2').status, 'succeeded');
  assert.equal((await main({ action: 'runOne', jobId: 'job-2' })).idle, true);
  assert.equal(calls.filter(row => row[0] === 'generate').length, 1);
});

test('定时模式拒绝普通管理调用；默认部署配置不包含触发器', async () => {
  const { main, calls } = worker();
  assert.equal((await main({})).code, 'TIMER_REQUIRED');
  assert.equal((await main({ Type: 'Timer', TriggerName: 'unknown' })).code, 'TIMER_REQUIRED');
  assert.equal(calls.length, 0);
  assert.equal(JSON.parse(fs.readFileSync('cloudfunctions/generation-worker/config.json')).triggers.length, 0);
});

test('付费 Worker 拒绝客户端调用，已有全局锁时不会生成', async () => {
  const client = worker({ client: true });
  assert.equal((await client.main()).code, 'INTERNAL_ONLY');
  assert.equal(client.calls.length, 0);
  const busy = worker({ locked: true });
  assert.equal((await busy.main()).busy, true);
  assert.equal(busy.calls.length, 0);
});

test('生成成功后转存私有目录，结果必须先审核且释放队列锁', async () => {
  const { main, db, calls } = worker();
  assert.equal((await main()).ok, true);
  assert.equal(calls[1][1], 'private/projects/project-1/renders/job-1.jpg');
  assert.equal(db.data.assets[0].reviewStatus, 'pending');
  assert.equal(db.data.assets[0].requirementsHash, 'hash-1');
  assert.equal(db.data.generation_jobs[0].status, 'succeeded');
  assert.equal(db.data.projects[0].generationActive, false);
  assert.equal(db.data.generation_locks[0].runId, '');
});

test('生图失败不会自动付费重试，任务保留失败状态', async () => {
  const { main, db, calls } = worker({ providerFails: true });
  assert.equal((await main()).ok, false);
  assert.equal(db.data.generation_jobs[0].status, 'failed');
  assert.equal(db.data.generation_jobs[0].attempts, 1);
  assert.equal(db.data.generation_locks[0].lockedUntil, '');
  await main();
  assert.equal(calls.filter(value => value[0] === 'generate').length, 1);
});

test('项目状态更新失败也会释放全局锁，不阻塞其他项目', async () => {
  const { main, db } = worker({ projectUpdateFails: true });
  await assert.rejects(main(), /PROJECT_STATUS_UNAVAILABLE/);
  assert.equal(db.data.generation_locks[0].runId, '');
});
