const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function checker(options = {}) {
  const exports = {}, calls = [];
  const code = ts.transpileModule(fs.readFileSync('miniprogram/package-engineer/storage-check.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require() { return { async engineerRequest(action) {
    calls.push(action);
    if (action === 'prepareUpload') return { assetId: 'asset-a', cloudPath: 'uploads/test-owner/project-a/asset-a.png' };
    if (action === 'getProject') return { assets: [{ _id: 'asset-a', previewUrl: 'https://example.test/signed-preview' }] };
    return { assetId: 'asset-a' };
  } }; }, wx: {
    env: { USER_DATA_PATH: '/local' },
    getFileSystemManager() { return { readFileSync() { return new ArrayBuffer(8); }, writeFileSync() { calls.push('local fixture'); } }; },
    cloud: {
      async uploadFile({ cloudPath }) { calls.push('upload:' + cloudPath); if (cloudPath.startsWith('private/')) { if (options.unexpectedWrite) return { fileID: 'cloud://env/bucket/private/unexpected.png' }; if (options.cloudStorageCode) throw { errCode: -503002, errMsg: 'Have no access right to the storage' }; throw { errMsg: options.networkFailure ? 'network timeout' : 'permission denied' }; } return { fileID: 'cloud://env/bucket/' + cloudPath }; },
      async downloadFile({ fileID }) { calls.push('download:' + fileID); if (options.emptyDownloadURL) throw { errCode: -403003, errMsg: 'internal server error: empty download url' }; throw { errMsg: 'permission denied' }; },
      async getTempFileURL({ fileList }) {
        calls.push('client URL lookup');
        if (options.urlNetworkFailure) throw { errMsg: 'network timeout' };
        if (options.missingResult) return { fileList: [] };
        return { fileList: [{ fileID: fileList[0], status: options.urlAllowed || options.emptySuccessURL ? 0 : options.symbolicAuthority || options.genericFileError ? 1 : options.fileMissing ? -503003 : -503002, tempFileURL: options.urlAllowed ? 'https://example.test/unexpected' : '', errMsg: options.fileMissing ? 'file not found' : options.symbolicAuthority ? 'STORAGE_EXCEED_AUTHORITY' : options.genericFileError ? 'COS_ACTION_FAILED' : '' }] };
      },
    },
    async getImageInfo() { calls.push('authorized image'); return { width: 320, height: 200 }; },
  } });
  return { check: exports.checkPrivateStorage, calls };
}

test('存储验证使用合成图，检查拒绝与授权预览，不提交生成或分享', async () => {
  const { check, calls } = checker();
  const report = await check('project-a', 'location-a');
  assert.equal(report.length, 6);
  assert.ok(calls.includes('finalizeUpload'));
  assert.ok(calls.includes('authorized image'));
  assert.ok(calls.includes('download:cloud://env/bucket/private/projects/project-a/source/asset-a.png'));
  assert.ok(!calls.includes('createGeneration') && !calls.includes('createShare'));
  assert.ok(!report.join('\n').includes('https://'));
});

test('网络失败不能被当作权限拒绝，私有直写意外成功时中止', async () => {
  for (const options of [{ networkFailure: true }, { unexpectedWrite: true }]) {
    const { check, calls } = checker(options);
    await assert.rejects(check('project-a', 'location-a'), /权限|允许/);
    assert.ok(!calls.includes('finalizeUpload'));
    assert.ok(!calls.includes('authorized image'));
  }
});

test('实际微信存储权限拒绝 -503002 能正确识别', async () => {
  const { check } = checker({ cloudStorageCode: true });
  const report = await check('project-a', 'location-a');
  assert.match(report[0], /已拒绝/);
});

test('下载链接为空必须核验逐文件 -503002，不能直接当作拒绝', async () => {
  const { check, calls } = checker({ emptyDownloadURL: true });
  const report = await check('project-a', 'location-a');
  assert.equal(calls.filter(item => item === 'client URL lookup').length, 2);
  assert.match(report[2], /已拒绝/);
  assert.match(report[4], /已拒绝/);
});

test('空链接伴随网络错误、缺失结果、文件不存在或成功状态均不得算作权限拒绝', async () => {
  for (const extra of [{ urlNetworkFailure: true }, { missingResult: true }, { fileMissing: true }, { emptySuccessURL: true }, { urlAllowed: true }, { genericFileError: true }]) {
    const { check, calls } = checker({ emptyDownloadURL: true, ...extra });
    await assert.rejects(check('project-a', 'location-a'));
    assert.ok(!calls.includes('finalizeUpload'));
  }
});

test('实际逐文件 status 1 仅在明确 STORAGE_EXCEED_AUTHORITY 时视为拒绝', async () => {
  const { check } = checker({ emptyDownloadURL: true, symbolicAuthority: true });
  const report = await check('project-a', 'location-a');
  assert.match(report[2], /已拒绝/);
  assert.match(report[4], /已拒绝/);
});
