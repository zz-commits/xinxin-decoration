const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fakeDB } = require('./helpers.cjs');
const publicApi = require('../cloudfunctions/public-api/content');
const engineerApi = require('../cloudfunctions/engineer-api/domain');
const shareApi = require('../cloudfunctions/share-api/domain');
const { buildPrompt } = require('../cloudfunctions/generation-worker/provider');
const identity = { APPID: 'wx4d0fe4f65e530325', OPENID: 'engineer-a' };
const location = { _id: 'location-a', projectId: 'project-a', name: '阳台', productTypes: ['railings', 'windows'], dimensions: { widthMm: 3000, heightMm: 1200 }, material: '304 不锈钢', finish: '拉丝', color: '深灰', structureNotes: '3 格栏杆与 2 扇推拉窗', customerRequirements: '保持通风' };
const initial = () => ({ users: [{ _id: 'engineer-a', role: 'engineer', status: 'active' }], projects: [{ _id: 'project-a', ownerOpenid: 'engineer-a', title: '阳台改造', customerDisplayName: '张女士', status: 'collecting' }, { _id: 'project-b', ownerOpenid: 'engineer-b' }], project_locations: [location], assets: [], generation_jobs: [], share_links: [] });
const cloud = { async getTempFileURL({ fileList }) { return { fileList: fileList.map(item => ({ fileID: item.fileID || item, tempFileURL: 'https://example.test/approved.jpg' })) }; } };

test('公开接口只返回已发布内容并删除私有字段和私有文件', async () => {
  const db = fakeDB({ store_config: [{ _id: 'main', status: 'published', name: '鑫新装饰', phones: ['15828637898'], ownerOpenid: 'private-user', address: '四河路264号', wechatQrImage: 'cloud://env.bucket/private/secret.png' }], services: [{ _id: 'railings', title: '栏杆', status: 'published', sortOrder: 1 }, { _id: 'hidden', status: 'draft' }], cases: [{ _id: 'draft', status: 'draft' }, { _id: 'public', status: 'published', publishedAt: '2026-10-14', coverImage: 'cloud://env.bucket/private/site.jpg', images: ['cloud://env.bucket/public/cases/ok.jpg', 'cloud://env.bucket/private/source.jpg'], engineerNotes: 'secret' }] });
  const handle = publicApi.createHandler(db);
  const catalogue = await handle({ action: 'getCatalogue' });
  assert.equal(catalogue.data.services.length, 1);
  assert.equal(catalogue.data.store.wechatQrImage, '');
  assert.equal(catalogue.data.store.ownerOpenid, undefined);
  const result = await handle({ action: 'listCases', payload: { page: 0 } });
  assert.equal(result.data.items.length, 1);
  assert.equal(result.data.items[0].coverImage, '');
  assert.equal(result.data.items[0].images.length, 1);
  assert.equal(result.data.items[0].engineerNotes, undefined);
  assert.equal((await handle({ action: 'getCase', payload: { id: 'draft' } })).data, null);
  assert.equal((await handle({ action: 'listCases', payload: { page: -1 } })).code, 'INVALID_ARGUMENT');
});

test('普通访客不能伪造工程师身份，工程师不能访问他人项目', async () => {
  const handle = engineerApi.createHandler(cloud, fakeDB(initial()));
  await assert.rejects(handle({ action: 'createProject', payload: { title: 'x', role: 'admin', openid: identity.OPENID } }, { ...identity, OPENID: 'visitor' }), { code: 'ENGINEER_REQUIRED' });
  await assert.rejects(handle({ action: 'getProject', payload: { projectId: 'project-b' } }, identity), { code: 'PROJECT_NOT_FOUND' });
  await assert.rejects(handle({ action: 'getProfile' }, { ...identity, APPID: 'wrong-app' }), { code: 'UNAUTHORIZED' });
});

test('项目归属来自微信身份；尺寸和产品字段由服务端校验', async () => {
  const db = fakeDB(initial()); const handle = engineerApi.createHandler(cloud, db);
  await handle({ action: 'createProject', payload: { title: '新项目', ownerOpenid: 'engineer-b', role: 'admin' } }, identity);
  assert.equal(db.data.projects[2].ownerOpenid, 'engineer-a');
  assert.throws(() => engineerApi.locationInput({ ...location, dimensions: { widthMm: -1 } }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => engineerApi.locationInput({ ...location, productTypes: ['unknown'] }), { code: 'INVALID_ARGUMENT' });
});

test('未审核、旧材质版本的效果图不能创建分享', async () => {
  const db = fakeDB(initial()); const handle = engineerApi.createHandler(cloud, db);
  db.data.assets.push({ _id: 'render-a', projectId: 'project-a', locationId: location._id, type: 'generated_image', status: 'ready', reviewStatus: 'pending', fileID: 'cloud://env.bucket/private/render.jpg', angle: '正面整体', requirementsHash: engineerApi.requirementsHash(location), createdAt: '2026-10-14T00:00:00Z' });
  await assert.rejects(handle({ action: 'createShare', payload: { projectId: 'project-a' } }, identity), { code: 'REVIEW_REQUIRED' });
  await assert.rejects(handle({ action: 'reviewAsset', payload: { projectId: 'project-a', assetId: 'render-a', decision: 'approved', checklist: { structure: true } } }, identity), { code: 'REVIEW_REQUIRED' });
  await handle({ action: 'reviewAsset', payload: { projectId: 'project-a', assetId: 'render-a', decision: 'approved', checklist: { structure: true, count: true, material: true, color: true, angles: true } } }, identity);
  db.data.project_locations[0].material = '铝合金';
  await assert.rejects(handle({ action: 'createShare', payload: { projectId: 'project-a' } }, identity), { code: 'REVIEW_REQUIRED' });
});

test('专属分享保存哈希与审核快照，停用或驳回后不可读取', async () => {
  const db = fakeDB(initial()); const handle = engineerApi.createHandler(cloud, db);
  db.data.assets.push({ _id: 'render-a', projectId: 'project-a', locationId: location._id, type: 'generated_image', status: 'ready', reviewStatus: 'approved', fileID: 'cloud://env.bucket/private/render.jpg', angle: '正面整体', requirementsHash: engineerApi.requirementsHash(location), createdAt: '2026-10-14T00:00:00Z' });
  const share = await handle({ action: 'createShare', payload: { projectId: 'project-a' } }, identity);
  assert.match(share.code, /^[a-f0-9]{48}$/);
  assert.equal(db.data.share_links[0].code, undefined);
  assert.equal(db.data.share_links[0]._id, crypto.createHash('sha256').update(share.code).digest('hex'));
  const readShare = shareApi.createHandler(cloud, db);
  const view = await readShare(share.code);
  assert.equal(view.locations[0].images.length, 1);
  assert.equal(view.locations[0].dimensions, undefined);
  assert.equal(view.locations[0].structureNotes, undefined);
  assert.equal(view.locations[0].images[0].fileID, undefined);
  assert.match(view.disclaimer, /最终结果以实际施工和安装效果为准/);
  db.data.assets[0].reviewStatus = 'rejected';
  assert.equal(await readShare(share.code), null);
  db.data.assets[0].reviewStatus = 'approved';
  await handle({ action: 'disableShare', payload: { projectId: 'project-a', shareId: db.data.share_links[0]._id } }, identity);
  assert.equal(await readShare(share.code), null);
  assert.equal(await readShare('invalid'), null);
});

test('过期分享即使状态未清理，也不能继续访问', async () => {
  const code = 'a'.repeat(48);
  const db = fakeDB({ share_links: [{ _id: crypto.createHash('sha256').update(code).digest('hex'), status: 'active', expiresAt: '2000-01-01T00:00:00Z' }] });
  assert.equal(await shareApi.createHandler(cloud, db)(code), null);
});

test('生成需要测量、结构简图和各角度照片，并阻止重复在途任务', async () => {
  const db = fakeDB(initial()); const handle = engineerApi.createHandler(cloud, db);
  const event = { action: 'createGeneration', payload: { projectId: 'project-a', locationId: 'location-a', views: [{ angle: '正面整体', sourceAssetId: 'photo-a' }] } };
  await assert.rejects(handle(event, identity), { code: 'INCOMPLETE_REQUIREMENTS' });
  db.data.assets.push({ _id: 'sketch-a', projectId: 'project-a', locationId: 'location-a', type: 'sketch', status: 'ready', fileID: 'cloud://env.bucket/private/sketch.jpg' }, { _id: 'photo-a', projectId: 'project-a', locationId: 'location-a', type: 'site_photo', status: 'ready', fileID: 'cloud://env.bucket/private/photo.jpg' });
  const preview = await handle({ ...event, action: 'getGenerationPreview' }, identity);
  event.payload.confirmationDigest = preview.confirmationDigest;
  event.payload.checklist = { structure: true, materials: true, views: true, usage: true };
  const result = await handle(event, identity);
  assert.equal(result.jobIds.length, 1);
  assert.equal(db.data.generation_jobs[0].status, 'queued');
  assert.equal(db.data.projects[0].generationActive, true);
  await assert.rejects(handle(event, identity), { code: 'GENERATION_IN_PROGRESS' });
  const prompt = buildPrompt(db.data.generation_jobs[0]);
  for (const expected of ['304 不锈钢', '拉丝', '深灰', '3000', '3 格栏杆与 2 扇推拉窗']) assert.ok(prompt.includes(expected));
});

test('上传完成登记拒绝其他项目文件和假图片', async () => {
  const db = fakeDB(initial());
  const unsafeCloud = { async downloadFile() { return { fileContent: Buffer.from('not-an-image') }; } };
  const handle = engineerApi.createHandler(unsafeCloud, db);
  const ticket = await handle({ action: 'prepareUpload', payload: { projectId: 'project-a', locationId: 'location-a', type: 'site_photo' } }, identity);
  await assert.rejects(handle({ action: 'finalizeUpload', payload: { projectId: 'project-a', assetId: ticket.assetId, fileID: 'cloud://env.bucket/private/someone-else.jpg' } }, identity), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(handle({ action: 'finalizeUpload', payload: { projectId: 'project-a', assetId: ticket.assetId, fileID: 'cloud://env.bucket/' + ticket.cloudPath } }, identity), { code: 'INVALID_IMAGE' });
});
