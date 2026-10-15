const crypto = require('node:crypto');
const cloud = require('wx-server-sdk');
const { generate } = require('./provider');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 150000 });
const db = cloud.database();
const now = () => new Date().toISOString();

exports.main = async (event = {}) => {
  // 仅允许定时触发或管理控制台执行，禁止小程序用户直接运行付费生成。
  const identity = cloud.getWXContext();
  if (identity.OPENID || identity.APPID) return { ok: false, code: 'INTERNAL_ONLY' };
  const mode = process.env.GENERATION_MODE || 'disabled';
  if (event.action === 'preflight') {
    // Read-only local capability report: does not call a model or touch the queue.
    return { ok: true, paidCall: false, mode, runtime: process.versions.node, sdkVersion: require('wx-server-sdk/package.json').version, aiAvailable: typeof cloud.ai === 'function', model: 'HY-Image-v3.0-I2I-ToB-v1.0.1' };
  }
  if (!['manual', 'scheduled'].includes(mode)) return { ok: false, code: 'GENERATION_PAUSED' };
  const manual = mode === 'manual';
  if (manual && (event.action !== 'runOne' || typeof event.jobId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(event.jobId))) return { ok: false, code: 'EXPLICIT_JOB_REQUIRED' };
  if (!manual && (event.Type !== 'Timer' || event.TriggerName !== 'image-queue')) return { ok: false, code: 'TIMER_REQUIRED' };
  const runId = crypto.randomUUID();
  const leaseUntil = new Date(Date.now() + 16 * 60000).toISOString();
  const locked = await db.runTransaction(async tx => {
    const row = await tx.collection('generation_locks').doc('image-worker').get();
    if (row.data.lockedUntil && row.data.lockedUntil > now()) return false;
    await tx.collection('generation_locks').doc('image-worker').update({ data: { runId, lockedUntil: leaseUntil } });
    return true;
  });
  if (locked !== true && !(locked && locked.result === true)) return { ok: true, busy: true };

  let job;
  try {
    // 过期的处理中任务先标记失败，避免未知结果的付费任务被自动重复提交。
    const stale = await db.collection('generation_jobs').where({ status: 'running', lockedUntil: db.command.lt(now()), ...(manual ? { _id: event.jobId } : {}) }).limit(10).get();
    for (const item of stale.data) {
      await db.collection('generation_jobs').doc(item._id).update({ data: { status: 'failed', errorMessage: '生成任务超时，请检查资源与运行日志后手动重试。', updatedAt: now() } });
      const remaining = await db.collection('generation_jobs').where({ projectId: item.projectId, status: db.command.in(['queued', 'running']) }).count();
      if (!remaining.total) await db.collection('projects').doc(item.projectId).update({ data: { generationActive: false, status: 'reviewing', updatedAt: now() } });
    }
    const queued = await db.collection('generation_jobs').where({ status: 'queued', ...(manual ? { _id: event.jobId } : {}) }).orderBy('createdAt', 'asc').limit(1).get();
    job = queued.data[0];
    if (!job) return { ok: true, idle: true };
    await db.collection('generation_jobs').doc(job._id).update({ data: { status: 'running', lockedUntil: leaseUntil, attempts: db.command.inc(1), updatedAt: now() } });
    const output = await generate(cloud, job);
    const stored = await cloud.uploadFile({ cloudPath: 'private/projects/' + job.projectId + '/renders/' + job._id + '.' + output.extension, fileContent: output.buffer });
    const assetId = 'render-' + job._id;
    await db.runTransaction(async tx => {
      await tx.collection('assets').doc(assetId).set({ data: { projectId: job.projectId, locationId: job.locationId, type: 'generated_image', status: 'ready', reviewStatus: 'pending', fileID: stored.fileID, angle: job.angle, ownerOpenid: job.createdBy, jobId: job._id, requirementsHash: job.requirementsHash, createdAt: now() } });
      await tx.collection('generation_jobs').doc(job._id).update({ data: { status: 'succeeded', outputAssetId: assetId, prompt: output.prompt, revisedPrompt: output.revisedPrompt, provider: output.provider, updatedAt: now() } });
    });
    return { ok: true, jobId: job._id };
  } catch (error) {
    if (job) await db.collection('generation_jobs').doc(job._id).update({ data: { status: 'failed', errorMessage: '生图未完成，请确认 CloudBase 生图权限、资源额度和参考图片，检查云函数日志后再重试。', updatedAt: now() } });
    console.error('generation-worker failed', { code: typeof error.code === 'string' ? error.code : 'GENERATION_FAILED', jobId: job && job._id });
    return { ok: false, code: 'GENERATION_FAILED', jobId: job && job._id };
  } finally {
    try {
      if (job) {
        const active = await db.collection('generation_jobs').where({ projectId: job.projectId, status: db.command.in(['queued', 'running']) }).count();
        if (!active.total) await db.collection('projects').doc(job.projectId).update({ data: { generationActive: false, status: 'reviewing', updatedAt: now() } });
      }
    } finally {
      // A project-status failure must not leave the entire generation queue locked.
      await db.collection('generation_locks').where({ _id: 'image-worker', runId }).update({ data: { lockedUntil: '', runId: '' } });
    }
  }
};
