const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const catalogue = require('../miniprogram/data/catalogue.json');
const structure = require('../shared/structure-plan');

function fixturesAt(envVersion = 'develop') {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('miniprogram/package-engineer/dev-fixtures.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 } }).outputText;
  vm.runInNewContext(code, { exports, wx: { getAccountInfoSync() { return { miniProgram: { envVersion } }; } } });
  return exports;
}

function pageAt(name, options = {}) {
  let configuration;
  const calls = [];
  const code = ts.transpileModule(fs.readFileSync('miniprogram/package-engineer/' + name + '/index.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 } }).outputText;
  vm.runInNewContext(code, {
    exports: {}, Page(value) { configuration = value; },
    require(name) {
      if (name.includes('catalogue')) return { catalogue };
      if (name.includes('structure-plan')) return structure;
      if (name.includes('dev-fixtures')) return fixturesAt(options.envVersion);
      if (name.includes('storage-check')) return { async checkPrivateStorage(projectId, locationId) { calls.push({ storageCheck: { projectId, locationId } }); return ['测试通过']; } };
      if (name.includes('engineer-api')) return {
        async engineerRequest(action, payload) { calls.push({ action, payload }); if (options.error) throw new Error(options.error); return options.handle ? options.handle(action, payload) : options.response; },
        showError(error) { calls.push({ error: error.message }); },
      };
      throw new Error(name);
    },
    wx: {
      navigateTo(value) { calls.push({ navigate: value.url }); },
      navigateBack(value) { calls.push({ back: value.delta }); },
      async showModal(value) { calls.push({ modal: value }); return { confirm: !options.cancel }; },
      showToast(value) { calls.push({ toast: value.title }); },
      showLoading() {}, hideLoading() {},
    },
  });
  const page = { ...configuration, data: JSON.parse(JSON.stringify(configuration.data)), setData(value) { Object.assign(this.data, value); } };
  for (const key of Object.keys(page)) if (typeof page[key] === 'function') page[key] = page[key].bind(page);
  return { page, calls };
}
const input = (field, value, extra = {}) => ({ currentTarget: { dataset: { field, ...extra } }, detail: { value } });
const checks = values => ({ detail: { value: values } });
const allChecks = ['structure', 'materials', 'views', 'usage'];
const preview = () => ({ confirmationDigest: 'current-digest', views: [{ angle: '正面整体', sourceAssetId: 'photo-a' }], location: { productTypes: ['windows'], dimensions: { widthMm: 2400 } } });

test('私有存储联调工具仅允许开发版指定测试项目，取消不上传', async () => {
  for (const options of [{ envVersion: 'release' }, { envVersion: 'trial' }, { customerProject: true }, { cancel: true }, { busy: true }]) {
    const { page, calls } = pageAt('project', options);
    page.projectId = 'project-a'; page.data.selectedId = 'location-a';
    page.data.project = { title: options.customerProject ? '真实客户项目' : fixturesAt().TEST_PROJECT_TITLE };
    page.data.busy = !!options.busy;
    await page.verifyDevelopmentStorage();
    assert.equal(calls.filter(row => row.storageCheck).length, 0);
  }
  const { page, calls } = pageAt('project');
  page.projectId = 'project-a'; page.data.selectedId = 'location-a'; page.data.project = { title: fixturesAt().TEST_PROJECT_TITLE };
  page.refresh = async () => {};
  await page.verifyDevelopmentStorage();
  assert.equal(calls.filter(row => row.storageCheck).length, 1);
  assert.equal(calls.filter(row => row.action).length, 0);
  assert.equal(page.data.busy, false);
});

test('新增安装面默认待确认，增删分格不丢失基本表单输入', () => {
  const { page } = pageAt('project');
  page.updateForm(input('name', '转角阳台'));
  page.addFace();
  const face = page.data.structurePlan.faces[0];
  assert.equal(face.cells[0].opening, 'pending');
  page.updatePlan(input('widthMm', '2400', { faceId: face.id }));
  page.addCell({ currentTarget: { dataset: { faceId: face.id } } });
  assert.equal(page.data.form.name, '转角阳台');
  assert.equal(page.data.structurePlan.faces[0].widthMm, '2400');
  assert.equal(page.data.structurePlan.faces[0].cells.length, 2);
});

test('编辑结构只改草稿，不污染已保存的安装位置对象', () => {
  const { page } = pageAt('project');
  const saved = { _id: 'location-a', productTypes: ['windows'], dimensions: {}, structurePlan: { version: 1, faces: [{ id: 'front', name: '正面', cells: [{ id: 'cell-a', name: '左格', opening: 'fixed' }] }] } };
  page.data.selected = saved;
  page.editLocation();
  page.updatePlan(input('name', '修改后的名称', { faceId: 'front', cellId: 'cell-a' }));
  assert.equal(saved.structurePlan.faces[0].cells[0].name, '左格');
  page.cancelEdit();
  assert.equal(page.data.editing, false);
});

test('取消选择会清空来源，重复现场照片不允许进入确认页', async () => {
  const { page, calls } = pageAt('project');
  page.data.sitePhotos = [{ _id: 'photo-a', previewUrl: 'https://example.test/photo' }];
  page.data.sourceNames = ['不生成此角度', '现场照片 1'];
  page.chooseSource({ currentTarget: { dataset: { index: 0 } }, detail: { value: '1' } });
  page.chooseSource({ currentTarget: { dataset: { index: 1 } }, detail: { value: '1' } });
  await page.generate();
  assert.ok(calls.some(row => row.error && row.error.includes('不同的现场照片')));
  assert.equal(calls.filter(row => row.navigate).length, 0);
  page.chooseSource({ currentTarget: { dataset: { index: 1 } }, detail: { value: '0' } });
  assert.equal(page.data.views[1].sourceIndex, -1);
  assert.equal(page.data.views[1].sourceUrl, '');
});

test('项目页下一步只导航，不直接创建付费任务', async () => {
  const { page, calls } = pageAt('project');
  page.projectId = 'project-a'; page.data.selectedId = 'location-a';
  page.data.sitePhotos = [{ _id: 'photo-a' }]; page.data.views[0].sourceIndex = 0;
  await page.generate();
  assert.match(calls[0].navigate, /^\/package-engineer\/generation\/index\?/);
  assert.equal(calls.filter(row => row.action).length, 0);
  const query = new URL('https://example.test' + calls[0].navigate).searchParams;
  assert.equal(JSON.parse(query.get('views'))[0].sourceAssetId, 'photo-a');
});

test('确认页必须勾选四项并通过确认弹窗，提交成功不能重复入队', async () => {
  const { page, calls } = pageAt('generation', { response: { jobIds: ['job-a'] } });
  page.data.preview = preview(); page.views = preview().views;
  await page.submit();
  assert.equal(calls.length, 0);
  page.chooseChecks(checks(allChecks.slice(0, 3))); await page.submit();
  assert.equal(calls.length, 0);
  page.chooseChecks(checks(allChecks)); await page.submit();
  const request = calls.find(row => row.action === 'createGeneration');
  assert.equal(request.payload.confirmationDigest, 'current-digest');
  assert.equal(request.payload.checklist.usage, true);
  await page.submit();
  assert.equal(calls.filter(row => row.action === 'createGeneration').length, 1);
});

test('取消资源消耗确认不提交；提交失败取消勾选但不自动重试', async () => {
  const cancelled = pageAt('generation', { cancel: true });
  cancelled.page.data.preview = preview(); cancelled.page.chooseChecks(checks(allChecks));
  await cancelled.page.submit();
  assert.equal(cancelled.calls.filter(row => row.action).length, 0);
  const failed = pageAt('generation', { error: '方案已改变' });
  failed.page.data.preview = preview(); failed.page.chooseChecks(checks(allChecks));
  await failed.page.submit();
  assert.equal(failed.page.data.confirmed, false);
  assert.equal(failed.page.data.checkFlags.structure, false);
  assert.equal(failed.calls.filter(row => row.action).length, 1);
});

test('重新读取方案会清空确认状态，避免沿用上次勾选', async () => {
  const { page } = pageAt('generation', { response: preview() });
  page.chooseChecks(checks(allChecks));
  await page.refresh();
  assert.equal(page.data.confirmed, false);
  assert.equal(page.data.checkFlags.materials, false);
  assert.match(page.data.dimensionLabel, /2400 mm/);
});

test('联调样例仅在开发版可用，内容是独立副本且通过结构规范化', () => {
  for (const version of ['trial', 'release', 'unknown']) assert.equal(fixturesAt(version).isDevelopmentBuild(), false);
  const fixtures = fixturesAt();
  assert.equal(fixtures.isDevelopmentBuild(), true);
  for (const kind of ['balcony', 'canopy']) {
    const sample = fixtures.developmentLocation(kind);
    const plan = structure.normalizeStructurePlan(sample.structurePlan);
    assert.deepEqual(structure.structureIssues(plan), []);
    assert.match(sample.form.customerRequirements, /不含真实客户/);
    assert.equal(sample.productTypes.length, 2);
    sample.structurePlan.faces[0].name = '已修改';
    assert.notEqual(fixtures.developmentLocation(kind).structurePlan.faces[0].name, '已修改');
  }
});

test('测试项目样例只预填不写云端；取消、未授权和正式版均不填入', async () => {
  const active = pageAt('projects');
  active.page.data.profile = { authorized: true };
  active.page.data.showCreate = true;
  await active.page.fillDevelopmentProject();
  assert.match(active.page.data.projectForm.title, /^开发联调测试项目/);
  assert.equal(active.calls.filter(row => row.action).length, 0);
  for (const options of [{ cancel: true }, { envVersion: 'release' }, { envVersion: 'trial' }]) {
    const denied = pageAt('projects', options);
    denied.page.data.profile = { authorized: true }; denied.page.data.showCreate = true;
    await denied.page.fillDevelopmentProject();
    assert.equal(denied.page.data.projectForm.title, '');
  }
  const guest = pageAt('projects'); guest.page.data.showCreate = true;
  await guest.page.fillDevelopmentProject();
  assert.equal(guest.calls.length, 0);
});

test('位置样例不得填入客户项目，也不会自动保存或生成', async () => {
  const fixtures = fixturesAt();
  const context = pageAt('project');
  context.page.data.project = { title: '真实客户项目' }; context.page.data.editing = true;
  const event = { currentTarget: { dataset: { kind: 'balcony' } } };
  await context.page.fillDevelopmentLocation(event);
  assert.equal(context.calls.length, 0);
  context.page.data.project = { title: fixtures.TEST_PROJECT_TITLE };
  await context.page.fillDevelopmentLocation(event);
  assert.equal(context.page.data.structurePlan.faces.length, 2);
  assert.equal(context.page.data.structurePlan.faces[0].cells[1].openingIndex, 4);
  assert.deepEqual(Array.from(context.page.data.selectedProducts), ['windows', 'railings']);
  assert.equal(context.calls.filter(row => row.action).length, 0);
  assert.equal(context.page.data.productOptions.filter(item => item.checked).length, 2);
});

test('纯文字联调草稿明确清空结构与尺寸，只预填等待手动保存', async () => {
  const fixtures = fixturesAt();
  const { page, calls } = pageAt('project');
  page.data.project = { title: fixtures.TEST_PROJECT_TITLE }; page.data.editing = true;
  await page.fillDevelopmentLocation({ currentTarget: { dataset: { kind: 'balcony' } } });
  await page.fillDevelopmentLocation({ currentTarget: { dataset: { kind: 'draft' } } });
  assert.equal(structure.normalizeStructurePlan(page.data.structurePlan), null);
  assert.equal(page.data.form.widthMm, '');
  assert.equal(page.data.form.heightMm, '');
  assert.equal(page.data.form.depthMm, '');
  assert.match(page.data.form.structureNotes, /不得生成或施工/);
  assert.equal(calls.filter(row => row.action).length, 0);
});

test('位置只读摘要展示已保存的产品组合和尺寸，切换草稿后清空旧摘要', () => {
  const { page } = pageAt('project');
  page.selectLocation({ _id: 'balcony', productTypes: ['windows', 'railings'], dimensions: { widthMm: 2400, heightMm: 2200, depthMm: 900 }, structurePlan: fixturesAt().developmentLocation('balcony').structurePlan });
  assert.match(page.data.productLabel, /铝合金门窗/);
  assert.match(page.data.productLabel, /护栏/);
  assert.equal(page.data.dimensionLabel, '宽 2400 mm × 高 2200 mm × 深 900 mm');
  assert.match(page.data.structureSummary, /正面/);
  page.selectLocation({ _id: 'draft', productTypes: ['canopies', 'accessories'], dimensions: {} });
  assert.equal(page.data.dimensionLabel, '未填写');
  assert.equal(page.data.structureSummary, '');
  assert.match(page.data.productLabel, /雨棚/);
  page.selectLocation(null);
  assert.equal(page.data.productLabel, '待确认');
});
