const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { normalizeStructurePlan, structureIssues, formatStructurePlan } = require('../shared/structure-plan');
const { createHandler, locationInput, requirementsHash } = require('../cloudfunctions/engineer-api/domain');
const { buildPrompt } = require('../cloudfunctions/generation-worker/provider');
const { fakeDB } = require('./helpers.cjs');
const identity = { APPID: 'wx4d0fe4f65e530325', OPENID: 'engineer-a' };
const checklist = { structure: true, materials: true, views: true, usage: true };
const plan = () => ({ version: 1, faces: [{ id: 'front', name: '正面', widthMm: '2400', heightMm: 1800, corner: '', obstacles: '左上角避让管道 80 × 120 mm', cells: [{ id: 'fixed', name: '左固定格', widthMm: 1200, heightMm: 1800, opening: 'fixed', direction: '', notes: '' }, { id: 'open', name: '右开扇', widthMm: 1200, heightMm: 1800, opening: 'inward', direction: '从室内看，右侧铰链，向内开', notes: '带纱窗' }] }], glass: '按确认配置', hardware: '深灰执手', constraints: '保留原墙与梁' });
const location = () => ({ _id: 'location-a', projectId: 'project-a', name: '阳台', productTypes: ['windows', 'railings'], dimensions: { widthMm: 2400, heightMm: 1800 }, material: '铝合金 + 304 不锈钢', finish: '喷涂 / 拉丝', color: '深灰 / 本色', structureNotes: '', customerRequirements: '保持通风', structurePlan: plan() });
function fixture() {
  const db = fakeDB({ users: [{ _id: identity.OPENID, role: 'engineer', status: 'active' }], projects: [{ _id: 'project-a', title: '测试项目', ownerOpenid: identity.OPENID }], project_locations: [location()], assets: [{ _id: 'sketch-a', projectId: 'project-a', locationId: 'location-a', type: 'sketch', status: 'ready', fileID: 'cloud://env.bucket/private/sketch.jpg' }, { _id: 'photo-a', projectId: 'project-a', locationId: 'location-a', type: 'site_photo', status: 'ready', fileID: 'cloud://env.bucket/private/photo.jpg' }, { _id: 'photo-b', projectId: 'project-a', locationId: 'location-a', type: 'site_photo', status: 'ready', fileID: 'cloud://env.bucket/private/photo-b.jpg' }], generation_jobs: [], share_links: [] });
  const cloud = { async getTempFileURL({ fileList }) { return { fileList: fileList.map(row => ({ ...row, tempFileURL: 'https://example.test/' + encodeURIComponent(row.fileID) })) }; } };
  const handle = createHandler(cloud, db);
  const payload = { projectId: 'project-a', locationId: 'location-a', views: [{ angle: '正面整体', sourceAssetId: 'photo-a' }] };
  return { db, handle, payload, cloud };
}

test('结构方案规范化数值并剔除客户端确认与身份伪造字段', () => {
  const input = plan(); input.approved = true; input.faces[0].ownerOpenid = 'other'; input.faces[0].cells[0].openingIndex = 99;
  const normalized = normalizeStructurePlan(input);
  assert.equal(normalized.faces[0].widthMm, 2400);
  assert.equal(normalized.approved, undefined);
  assert.equal(normalized.faces[0].ownerOpenid, undefined);
  assert.equal(normalized.faces[0].cells[0].openingIndex, undefined);
  assert.equal(structureIssues(normalized).length, 0);
});

test('拒绝结构异常数值、未知开启方式、重复标识和超量安装面', () => {
  const cases = [
    value => { value.faces[0].widthMm = true; },
    value => { value.faces[0].heightMm = -1; },
    value => { value.faces[0].cells[0].opening = 'guess'; },
    value => { value.faces[0].cells[1].id = 'fixed'; },
    value => { value.faces = Array.from({ length: 7 }, (_row, index) => ({ ...value.faces[0], id: 'face-' + index })); },
  ];
  for (const change of cases) { const value = plan(); change(value); assert.throws(() => normalizeStructurePlan(value), { code: 'INVALID_ARGUMENT' }); }
});

test('未知开扇和缺失尺寸可存草稿，但生成完整性检查不通过', () => {
  const value = plan(); value.faces[0].cells[1].opening = 'pending'; value.faces[0].widthMm = ''; value.faces[0].cells[0].heightMm = '';
  const draft = normalizeStructurePlan(value);
  const issues = structureIssues(draft);
  assert.ok(issues.some(item => item.includes('总宽 / 高')));
  assert.ok(issues.some(item => item.includes('分格宽 / 高')));
  assert.ok(issues.some(item => item.includes('开启方式')));
});

test('多面方案需要相邻关系，非固定开扇需要明确方向', () => {
  const value = plan(); value.faces.push({ ...value.faces[0], id: 'side', name: '右侧面', corner: '' }); value.faces[0].cells[1].direction = '';
  const issues = structureIssues(normalizeStructurePlan(value));
  assert.ok(issues.some(item => item.includes('转角关系')));
  assert.ok(issues.some(item => item.includes('开启方向')));
});

test('空结构扩展不改变旧方案哈希，分格和材质变更会改变哈希', () => {
  const value = location(); delete value.structurePlan; value.structureNotes = '三格窗';
  const old = { name: value.name, productTypes: value.productTypes, dimensions: value.dimensions, material: value.material, finish: value.finish, color: value.color, customerRequirements: value.customerRequirements, structureNotes: value.structureNotes };
  const hash = crypto.createHash('sha256').update(JSON.stringify(old)).digest('hex');
  assert.equal(requirementsHash(value), hash);
  assert.equal(requirementsHash({ ...value, structurePlan: { version: 1, faces: [], glass: '', hardware: '', constraints: '' } }), hash);
  const structured = location(); const before = requirementsHash(structured); structured.structurePlan.faces[0].cells[0].widthMm = 1000;
  assert.notEqual(requirementsHash(structured), before);
});

test('编辑清空结构方案和尺寸后，重新读取不能残留旧要求', async () => {
  const { handle, payload } = fixture();
  const updated = { ...location(), dimensions: {}, structureNotes: '改为纯文字草稿', structurePlan: { version: 1, faces: [], glass: '', hardware: '', constraints: '' } };
  await handle({ action: 'saveLocation', payload: { projectId: payload.projectId, locationId: payload.locationId, location: updated } }, identity);
  const result = await handle({ action: 'getProject', payload: { projectId: payload.projectId } }, identity);
  assert.deepEqual(result.locations[0].dimensions, {});
  assert.equal(normalizeStructurePlan(result.locations[0].structurePlan), null);
  assert.equal(requirementsHash(result.locations[0]), requirementsHash(updated));
});

test('预览只读取方案；文字摘要和生成提示词保留分格、避让与材料', async () => {
  const { db, handle, payload } = fixture();
  const preview = await handle({ action: 'getGenerationPreview', payload }, identity);
  assert.equal(db.data.generation_jobs.length, 0);
  assert.equal(preview.views.length, 1);
  assert.equal(preview.sketches.length, 1);
  assert.equal(preview.legacyStructure, false);
  const prompt = buildPrompt({ inputSnapshot: preview.location, angle: '正面整体' });
  for (const expected of ['左固定格', '右侧铰链', '避让管道', '保留原墙与梁', '深灰执手', '2400']) {
    assert.ok(formatStructurePlan(preview.location.structurePlan).includes(expected));
    assert.ok(prompt.includes(expected));
  }
});

test('缺少逐项确认或伪造预览摘要不能创建生成任务', async () => {
  const { db, handle, payload } = fixture();
  const preview = await handle({ action: 'getGenerationPreview', payload }, identity);
  await assert.rejects(handle({ action: 'createGeneration', payload: { ...payload, confirmationDigest: preview.confirmationDigest } }, identity), { code: 'CONFIRMATION_REQUIRED' });
  await assert.rejects(handle({ action: 'createGeneration', payload: { ...payload, checklist, confirmationDigest: 'wrong' } }, identity), { code: 'STALE_PREVIEW' });
  assert.equal(db.data.generation_jobs.length, 0);
});

test('确认后材料、结构、现场照片或简图改变都会拒绝旧确认', async () => {
  for (const change of [
    ({ db }) => { db.data.project_locations[0].color = '白'; },
    ({ db }) => { db.data.project_locations[0].structurePlan.faces[0].cells[0].widthMm = 1300; },
    ({ payload }) => { payload.views[0].sourceAssetId = 'photo-b'; },
    ({ db }) => { db.data.assets[0].fileID = 'cloud://env.bucket/private/new-sketch.jpg'; },
  ]) {
    const state = fixture();
    const preview = await state.handle({ action: 'getGenerationPreview', payload: state.payload }, identity);
    change(state);
    await assert.rejects(state.handle({ action: 'createGeneration', payload: { ...state.payload, checklist, confirmationDigest: preview.confirmationDigest } }, identity), { code: 'STALE_PREVIEW' });
    assert.equal(state.db.data.generation_jobs.length, 0);
  }
});

test('确认成功冻结结构快照和工程师确认记录；重复提交不重复入队', async () => {
  const { db, handle, payload } = fixture();
  const preview = await handle({ action: 'getGenerationPreview', payload }, identity);
  const request = { action: 'createGeneration', payload: { ...payload, checklist, confirmationDigest: preview.confirmationDigest } };
  await handle(request, identity);
  assert.equal(db.data.generation_jobs[0].confirmedBy, identity.OPENID);
  assert.equal(db.data.generation_jobs[0].inputSnapshot.structurePlan.faces[0].widthMm, 2400);
  await assert.rejects(handle(request, identity), { code: 'GENERATION_IN_PROGRESS' });
  assert.equal(db.data.generation_jobs.length, 1);
  db.data.project_locations[0].structurePlan.faces[0].widthMm = 2500;
  assert.equal(db.data.generation_jobs[0].inputSnapshot.structurePlan.faces[0].widthMm, 2400);
});

test('不完整结构或不可查看的参考资料不能进入确认流程', async () => {
  const { db, handle, payload, cloud } = fixture();
  db.data.project_locations[0].structurePlan.faces[0].cells[0].opening = 'pending';
  await assert.rejects(handle({ action: 'getGenerationPreview', payload }, identity), { code: 'INCOMPLETE_REQUIREMENTS' });
  db.data.project_locations[0].structurePlan.faces[0].cells[0].opening = 'fixed';
  cloud.getTempFileURL = async () => ({ fileList: [] });
  await assert.rejects(handle({ action: 'getGenerationPreview', payload }, identity), { code: 'ASSET_NOT_READY' });
});

test('方案改变后不能重试旧任务，也不能分享旧分格版本的图片', async () => {
  const { db, handle, payload } = fixture();
  db.data.generation_jobs.push({ _id: 'old-job', projectId: 'project-a', locationId: 'location-a', status: 'failed', attempts: 1, requirementsHash: requirementsHash(location()) });
  db.data.assets.push({ _id: 'old-render', projectId: 'project-a', locationId: 'location-a', type: 'generated_image', status: 'ready', reviewStatus: 'approved', requirementsHash: requirementsHash(location()), createdAt: '2026-01-01', angle: '正面整体' });
  db.data.project_locations[0].structurePlan.faces[0].cells[0].widthMm = 1500;
  await assert.rejects(handle({ action: 'retryGeneration', payload: { projectId: payload.projectId, jobId: 'old-job' } }, identity), { code: 'STALE_PREVIEW' });
  await assert.rejects(handle({ action: 'createShare', payload: { projectId: payload.projectId } }, identity), { code: 'REVIEW_REQUIRED' });
});
