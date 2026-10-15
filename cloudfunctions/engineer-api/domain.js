const crypto = require('node:crypto');
const { normalizeStructurePlan, structureIssues, formatStructurePlan } = require('./structure-plan');
const APP_ID = 'wx4d0fe4f65e530325';
const DISCLAIMER = 'AI 效果预览图，仅用于方案沟通与展示；颜色、材质、比例及细节可能存在偏差，最终结果以实际施工和安装效果为准。';
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : fail('INVALID_ARGUMENT', '数据 ID 不正确。');
const text = (value, max, required = false) => {
  if (value !== undefined && typeof value !== 'string') fail('INVALID_ARGUMENT', '文字字段格式不正确。');
  const result = (value || '').trim();
  if (result.length > max || (required && !result)) fail('INVALID_ARGUMENT', '请检查必填文字和字数。');
  return result;
};
const timestamp = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const requirementsHash = location => crypto.createHash('sha256').update(JSON.stringify(locationInput(location))).digest('hex');

function locationInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_ARGUMENT', '安装位置格式不正确。');
  if (input.dimensions !== undefined && (!input.dimensions || typeof input.dimensions !== 'object' || Array.isArray(input.dimensions))) fail('INVALID_ARGUMENT', '尺寸格式不正确。');
  const productTypes = Array.isArray(input.productTypes) ? [...new Set(input.productTypes)] : [];
  if (!productTypes.length || productTypes.length > 6 || productTypes.some(item => !['railings', 'windows', 'canopies', 'sunrooms', 'gates', 'accessories'].includes(item))) fail('INVALID_ARGUMENT', '请选择至少一种产品。');
  const dimensions = {};
  for (const field of ['widthMm', 'heightMm', 'depthMm']) {
    const value = input.dimensions && input.dimensions[field];
    if (value !== '' && value !== undefined && value !== null) {
      if (!['string', 'number'].includes(typeof value)) fail('INVALID_ARGUMENT', '尺寸应为有效的正数，单位为毫米。');
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0 || number > 1000000) fail('INVALID_ARGUMENT', '尺寸应为有效的正数，单位为毫米。');
      dimensions[field] = number;
    }
  }
  const result = { name: text(input.name, 60, true), productTypes, dimensions, material: text(input.material, 300, true), finish: text(input.finish, 200), color: text(input.color, 100), customerRequirements: text(input.customerRequirements, 2000), structureNotes: text(input.structureNotes, 2000) };
  const plan = normalizeStructurePlan(input.structurePlan);
  if (plan) result.structurePlan = plan;
  return result;
}

async function first(db, collection, where) {
  const result = await db.collection(collection).where(where).limit(1).get();
  return result.data[0] || null;
}

function canAccessProject(project, actor) {
  return actor.role === 'admin' || project.ownerOpenid === actor.openid;
}

function createHandler(cloud, db) {
  async function projectFor(projectId, actor) {
    const project = await first(db, 'projects', { _id: id(projectId) });
    if (!project || !canAccessProject(project, actor)) fail('PROJECT_NOT_FOUND', '项目不存在或没有访问权限。');
    return project;
  }

  async function prepareGeneration(project, input) {
    const location = await first(db, 'project_locations', { _id: id(input.locationId), projectId: project._id });
    if (!location) fail('LOCATION_NOT_FOUND', '安装位置不存在。');
    const snapshot = locationInput(location);
    if (!snapshot.structureNotes && !(snapshot.structurePlan && snapshot.structurePlan.faces.length)) fail('INCOMPLETE_REQUIREMENTS', '请先录入结构简图的关键文字或分面分格方案。');
    if (!Object.keys(snapshot.dimensions).length && !(snapshot.structurePlan && snapshot.structurePlan.faces.length)) fail('INCOMPLETE_REQUIREMENTS', '请先录入现场测量尺寸，单位为毫米。');
    const issues = structureIssues(snapshot.structurePlan);
    if (issues.length) fail('INCOMPLETE_REQUIREMENTS', '以下信息尚未确认：' + issues.slice(0, 3).join('；') + (issues.length > 3 ? '；另有 ' + (issues.length - 3) + ' 项，请先编辑方案。' : '。请先编辑方案。'));
    const sketches = await db.collection('assets').where({ projectId: project._id, locationId: location._id, type: 'sketch', status: 'ready' }).limit(30).get();
    if (!sketches.data.length) fail('INCOMPLETE_REQUIREMENTS', '请先上传工程师结构简图。');
    const views = input.views;
    if (!Array.isArray(views) || views.length < 1 || views.length > 4) fail('INVALID_ARGUMENT', '请选择 1–4 个需要生成的角度。');
    const sources = [];
    for (const view of views) {
      if (!view || !['正面整体', '左侧斜视', '右侧斜视', '室内向外'].includes(view.angle) || sources.some(item => item.angle === view.angle || item.sourceAssetId === view.sourceAssetId)) fail('INVALID_ARGUMENT', '角度不能重复，请为不同角度提供不同的现场照片。');
      const source = await first(db, 'assets', { _id: id(view.sourceAssetId), projectId: project._id, locationId: location._id, type: 'site_photo', status: 'ready' });
      if (!source) fail('ASSET_NOT_READY', '请为每个角度选择对应的现场照片。');
      sources.push({ angle: view.angle, sourceAssetId: source._id, sourceFileID: source.fileID });
    }
    const hash = requirementsHash(snapshot);
    const digest = crypto.createHash('sha256').update(JSON.stringify({ requirementsHash: hash, sources, sketches: sketches.data.map(item => ({ id: item._id, fileID: item.fileID })).sort((a, b) => a.id.localeCompare(b.id)) })).digest('hex');
    return { location, snapshot, sources, sketches: sketches.data, hash, digest };
  }

  return async function handle(event = {}, identity) {
    if (!identity || identity.APPID !== APP_ID || !identity.OPENID) fail('UNAUTHORIZED', '请从鑫新装饰小程序访问。');
    const openid = identity.OPENID;
    const user = await first(db, 'users', { _id: openid, status: 'active' });
    const authorized = !!user && ['engineer', 'admin'].includes(user.role);
    if (event.action === 'getProfile') return { authorized, openid, name: authorized ? user.name || '工程师' : '', role: authorized ? user.role : '' };
    if (!authorized) fail('ENGINEER_REQUIRED', '尚未开通工程师权限，请联系店铺管理员。');
    const actor = { openid, role: user.role };
    const input = event.payload || {};

    if (event.action === 'listProjects') {
      const where = actor.role === 'admin' ? {} : { ownerOpenid: openid };
      const rows = await db.collection('projects').where(where).orderBy('updatedAt', 'desc').limit(50).get();
      return { items: rows.data.map(row => ({ _id: row._id, title: row.title, community: row.community, customerDisplayName: row.customerDisplayName, status: row.status, updatedAt: row.updatedAt })) };
    }

    if (event.action === 'createProject') {
      const project = { _id: uuid(), title: text(input.title, 100, true), community: text(input.community, 100), customerDisplayName: text(input.customerDisplayName, 60), status: 'draft', ownerOpenid: openid, createdAt: timestamp(), updatedAt: timestamp() };
      await db.collection('projects').add({ data: project });
      return { projectId: project._id };
    }

    const project = await projectFor(input.projectId, actor);
    if (event.action === 'getProject') {
      const [locations, assets, jobs, shares] = await Promise.all([
        db.collection('project_locations').where({ projectId: project._id }).orderBy('createdAt', 'asc').limit(30).get(),
        db.collection('assets').where({ projectId: project._id, status: 'ready' }).limit(100).get(),
        db.collection('generation_jobs').where({ projectId: project._id }).orderBy('createdAt', 'desc').limit(50).get(),
        db.collection('share_links').where({ projectId: project._id, status: 'active' }).orderBy('createdAt', 'desc').limit(20).get(),
      ]);
      const fileIDs = assets.data.map(item => item.fileID).filter(Boolean);
      const urls = new Map();
      for (let i = 0; i < fileIDs.length; i += 50) {
        const resolved = await cloud.getTempFileURL({ fileList: fileIDs.slice(i, i + 50).map(fileID => ({ fileID, maxAge: 600 })) });
        for (const item of resolved.fileList || []) if (item.tempFileURL) urls.set(item.fileID, item.tempFileURL);
      }
      return { project, locations: locations.data, assets: assets.data.map(item => ({ _id: item._id, locationId: item.locationId, type: item.type, angle: item.angle || '', reviewStatus: item.reviewStatus || 'pending', previewUrl: urls.get(item.fileID) || '' })), jobs: jobs.data.map(item => ({ _id: item._id, locationId: item.locationId, angle: item.angle, status: item.status, errorMessage: item.errorMessage || '' })), shares: shares.data.map(item => ({ _id: item._id, expiresAt: item.expiresAt, createdAt: item.createdAt })) };
    }

    if (event.action === 'saveLocation') {
      const values = locationInput(input.location);
      if (input.locationId) {
        const existing = await first(db, 'project_locations', { _id: id(input.locationId), projectId: project._id });
        if (!existing) fail('LOCATION_NOT_FOUND', '安装位置不存在。');
        // CloudBase recursively merges plain objects in update; explicitly replace
        // editable objects so cleared dimensions / removed structure do not linger.
        await db.collection('project_locations').doc(existing._id).update({ data: { ...values, dimensions: db.command.set(values.dimensions), structurePlan: values.structurePlan ? db.command.set(values.structurePlan) : db.command.remove(), updatedAt: timestamp() } });
        await db.collection('projects').doc(project._id).update({ data: { updatedAt: timestamp() } });
        return { locationId: existing._id };
      }
      const count = await db.collection('project_locations').where({ projectId: project._id }).count();
      if (count.total >= 20) fail('LIMIT_REACHED', '首版每个项目最多支持 20 个安装位置。');
      const location = { _id: uuid(), projectId: project._id, ...values, createdAt: timestamp(), updatedAt: timestamp() };
      await db.collection('project_locations').add({ data: location });
      await db.collection('projects').doc(project._id).update({ data: { status: 'collecting', updatedAt: timestamp() } });
      return { locationId: location._id };
    }

    if (event.action === 'prepareUpload') {
      const location = await first(db, 'project_locations', { _id: id(input.locationId), projectId: project._id });
      if (!location) fail('LOCATION_NOT_FOUND', '请先保存安装位置。');
      if (!['site_photo', 'sketch', 'material_reference'].includes(input.type)) fail('INVALID_ARGUMENT', '资料类型不正确。');
      const count = await db.collection('assets').where({ projectId: project._id, locationId: location._id, status: 'ready' }).count();
      if (count.total >= 30) fail('LIMIT_REACHED', '每个安装位置最多支持 30 份资料。');
      const assetId = uuid();
      const extension = input.extension === 'png' ? 'png' : 'jpg';
      const cloudPath = 'uploads/' + openid + '/' + project._id + '/' + assetId + '.' + extension;
      await db.collection('assets').add({ data: { _id: assetId, projectId: project._id, locationId: location._id, type: input.type, ownerOpenid: openid, cloudPath, status: 'uploading', createdAt: timestamp() } });
      return { assetId, cloudPath };
    }

    if (event.action === 'finalizeUpload') {
      const asset = await first(db, 'assets', { _id: id(input.assetId), projectId: project._id, ownerOpenid: openid });
      if (!asset || asset.status !== 'uploading' || typeof input.fileID !== 'string') fail('ASSET_NOT_READY', '上传任务不正确或已完成。');
      const expectedSuffix = '/' + asset.cloudPath;
      if (!/^cloud:\/\/[^/]+\//.test(input.fileID) || !input.fileID.endsWith(expectedSuffix)) fail('INVALID_ARGUMENT', '上传文件与任务不匹配。');
      const downloaded = await cloud.downloadFile({ fileID: input.fileID });
      const buffer = downloaded.fileContent;
      const jpeg = buffer && buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      const png = buffer && buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      if (!buffer || buffer.length > 8 * 1024 * 1024 || (!jpeg && !png)) fail('INVALID_IMAGE', '仅支持 8MB 以内的 JPG 或 PNG 图片。');
      const saved = await cloud.uploadFile({ cloudPath: 'private/projects/' + project._id + '/source/' + asset._id + (png ? '.png' : '.jpg'), fileContent: buffer });
      await db.collection('assets').doc(asset._id).update({ data: { status: 'ready', fileID: saved.fileID, size: buffer.length, updatedAt: timestamp() } });
      // 登记成功后清理本次上传的中转文件，正式资料保留在 private/ 中。
      try { await cloud.deleteFile({ fileList: [input.fileID] }); } catch (_error) { /* 中转文件可后续清理。 */ }
      return { assetId: asset._id };
    }

    if (event.action === 'getGenerationPreview' || event.action === 'createGeneration') {
      const prepared = await prepareGeneration(project, input);
      if (event.action === 'getGenerationPreview') {
        const files = [...prepared.sources.map(source => source.sourceFileID), ...prepared.sketches.map(sketch => sketch.fileID)].filter(Boolean);
        const urls = new Map();
        for (let index = 0; index < files.length; index += 50) {
          const resolved = await cloud.getTempFileURL({ fileList: files.slice(index, index + 50).map(fileID => ({ fileID, maxAge: 600 })) });
          for (const row of resolved.fileList || []) if (row.tempFileURL) urls.set(row.fileID, row.tempFileURL);
        }
        if (prepared.sources.some(source => !urls.has(source.sourceFileID)) || prepared.sketches.some(sketch => !urls.has(sketch.fileID))) fail('ASSET_NOT_READY', '现场照片或简图暂不可查看，请检查资料后重新加载。');
        return { projectTitle: project.title, location: prepared.snapshot, structureSummary: formatStructurePlan(prepared.snapshot.structurePlan), legacyStructure: !(prepared.snapshot.structurePlan && prepared.snapshot.structurePlan.faces.length), confirmationDigest: prepared.digest, views: prepared.sources.map(source => ({ angle: source.angle, sourceAssetId: source.sourceAssetId, previewUrl: urls.get(source.sourceFileID) || '' })), sketches: prepared.sketches.map(sketch => ({ id: sketch._id, previewUrl: urls.get(sketch.fileID) || '' })) };
      }
      const checklist = input.checklist || {};
      if (['structure', 'materials', 'views', 'usage'].some(key => checklist[key] !== true)) fail('CONFIRMATION_REQUIRED', '请在方案确认页逐项核对结构、材料、现场照片和资源消耗。');
      if (input.confirmationDigest !== prepared.digest) fail('STALE_PREVIEW', '方案或参考资料已改变，请重新加载方案确认页后再提交。');
      const jobs = prepared.sources.map(source => ({ _id: uuid(), projectId: project._id, locationId: prepared.location._id, ...source, requirementsHash: prepared.hash, confirmationDigest: prepared.digest, confirmedBy: openid, confirmedAt: timestamp(), status: 'queued', attempts: 0, inputSnapshot: prepared.snapshot, createdBy: openid, createdAt: timestamp(), updatedAt: timestamp() }));
      const active = await db.collection('generation_jobs').where({ projectId: project._id, status: db.command.in(['queued', 'running']) }).count();
      if (active.total) fail('GENERATION_IN_PROGRESS', '项目还有生成任务未完成，请先等待结果。');
      await db.runTransaction(async tx => {
        const current = await tx.collection('projects').doc(project._id).get();
        if (current.data.generationActive) fail('GENERATION_IN_PROGRESS', '项目还有生成任务未完成，请先等待结果。');
        const currentLocation = await tx.collection('project_locations').doc(prepared.location._id).get();
        if (requirementsHash(currentLocation.data) !== prepared.hash) fail('STALE_PREVIEW', '方案已改变，请重新确认后提交。');
        for (const job of jobs) {
          const { _id, ...record } = job;
          await tx.collection('generation_jobs').doc(_id).set({ data: record });
        }
        await tx.collection('projects').doc(project._id).update({ data: { generationActive: true, status: 'generating', updatedAt: timestamp() } });
      });
      return { jobIds: jobs.map(job => job._id) };
    }

    if (event.action === 'reviewAsset') {
      const asset = await first(db, 'assets', { _id: id(input.assetId), projectId: project._id, type: 'generated_image', status: 'ready' });
      if (!asset) fail('ASSET_NOT_READY', '效果图不存在。');
      if (!['approved', 'rejected'].includes(input.decision)) fail('INVALID_ARGUMENT', '审核结果不正确。');
      const checklist = input.checklist || {};
      if (input.decision === 'approved' && ['structure', 'count', 'material', 'color', 'angles'].some(key => checklist[key] !== true)) fail('REVIEW_REQUIRED', '请完成结构、数量、材质、颜色和多角度一致性核对。');
      await db.runTransaction(async tx => {
        await tx.collection('assets').doc(asset._id).update({ data: { reviewStatus: input.decision, reviewedBy: openid, reviewedAt: timestamp() } });
        await tx.collection('render_reviews').doc(uuid()).set({ data: { assetId: asset._id, projectId: project._id, decision: input.decision, checklist: input.decision === 'approved' ? { structure: true, count: true, material: true, color: true, angles: true } : {}, reviewedBy: openid, reviewedAt: timestamp() } });
      });
      return { assetId: asset._id, decision: input.decision };
    }

    if (event.action === 'retryGeneration') {
      const job = await first(db, 'generation_jobs', { _id: id(input.jobId), projectId: project._id });
      if (!job || job.status !== 'failed') fail('INVALID_PROJECT_STATE', '仅可重试失败的生成任务。');
      if (job.attempts >= 3) fail('RETRY_LIMIT', '该任务已尝试 3 次，请调整资料后创建新任务。');
      const currentLocation = await first(db, 'project_locations', { _id: job.locationId, projectId: project._id });
      if (!currentLocation || requirementsHash(currentLocation) !== job.requirementsHash) fail('STALE_PREVIEW', '方案要求已改变，不能重试旧版本。请重新确认当前方案并创建新任务。');
      await db.runTransaction(async tx => {
        const current = await tx.collection('projects').doc(project._id).get();
        if (current.data.generationActive) fail('GENERATION_IN_PROGRESS', '项目还有生成任务未完成，请先等待结果。');
        const latestLocation = await tx.collection('project_locations').doc(job.locationId).get();
        if (requirementsHash(latestLocation.data) !== job.requirementsHash) fail('STALE_PREVIEW', '方案要求已改变，请重新确认当前方案并创建任务。');
        await tx.collection('generation_jobs').doc(job._id).update({ data: { status: 'queued', errorMessage: '', updatedAt: timestamp() } });
        await tx.collection('projects').doc(project._id).update({ data: { generationActive: true, status: 'generating', updatedAt: timestamp() } });
      });
      return { jobId: job._id };
    }

    if (event.action === 'createShare') {
      const assets = await db.collection('assets').where({ projectId: project._id, type: 'generated_image', status: 'ready', reviewStatus: 'approved' }).orderBy('createdAt', 'desc').limit(100).get();
      if (!assets.data.length) fail('REVIEW_REQUIRED', '请先审核并确认至少一张效果图。');
      const locations = await db.collection('project_locations').where({ projectId: project._id }).limit(30).get();
      const currentHashes = new Map(locations.data.map(location => [location._id, requirementsHash(location)]));
      const selectedAssets = new Map();
      for (const asset of assets.data) {
        const key = asset.locationId + '\n' + asset.angle;
        if (asset.requirementsHash === currentHashes.get(asset.locationId) && !selectedAssets.has(key)) selectedAssets.set(key, asset);
      }
      const approvedAssets = [...selectedAssets.values()];
      if (!approvedAssets.length) fail('REVIEW_REQUIRED', '方案要求已改变，请重新生成并审核与当前材料和结构要求一致的效果图。');
      const code = crypto.randomBytes(24).toString('hex');
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      const snapshot = { title: project.title, customerDisplayName: project.customerDisplayName, locations: locations.data.filter(location => approvedAssets.some(asset => asset.locationId === location._id)).map(location => ({ _id: location._id, name: location.name, productTypes: location.productTypes, material: location.material, finish: location.finish || '', color: location.color || '', images: approvedAssets.filter(asset => asset.locationId === location._id).map(asset => ({ assetId: asset._id, fileID: asset.fileID, angle: asset.angle || '效果预览' })) })), disclaimer: DISCLAIMER };
      await db.collection('share_links').doc(codeHash).set({ data: { projectId: project._id, snapshot, status: 'active', createdBy: openid, createdAt: timestamp(), expiresAt } });
      await db.collection('projects').doc(project._id).update({ data: { status: 'shareable', updatedAt: timestamp() } });
      return { code, sharePath: '/pages/project-share/index?code=' + code, expiresAt };
    }

    if (event.action === 'disableShare') {
      const share = await first(db, 'share_links', { _id: id(input.shareId), projectId: project._id });
      if (!share) fail('SHARE_NOT_FOUND', '分享记录不存在。');
      await db.collection('share_links').doc(share._id).update({ data: { status: 'disabled', disabledAt: timestamp() } });
      return { disabled: true };
    }

    fail('INVALID_ACTION', '不支持的操作。');
  };
}

module.exports = { createHandler, canAccessProject, locationInput, requirementsHash, DISCLAIMER };
