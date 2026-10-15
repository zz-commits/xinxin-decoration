const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const catalogue = require('../miniprogram/data/catalogue.json');

function loadClient(options = {}) {
  const exports = {};
  const calls = [];
  const code = ts.transpileModule(fs.readFileSync('miniprogram/services/public-api.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 } }).outputText;
  vm.runInNewContext(code, {
    exports,
    require(name) { if (name.includes('catalogue')) return { catalogue }; if (name.includes('config/cloud')) return { cloudConfig: { envId: 'cloud1-d8g6md4r9e96e1f14' } }; throw new Error(name); },
    getApp: () => ({ globalData: { cloudReady: true } }),
    wx: {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: options.release ? 'release' : 'develop' } }),
      cloud: { async callFunction(value) { calls.push(value); if (options.error) throw new Error('not deployed'); return { result: { ok: true, data: options.data || catalogue } }; } },
      async showActionSheet({ itemList }) { calls.push(itemList); return { tapIndex: 1 }; },
      async makePhoneCall(value) { calls.push(value); },
      showToast(value) { calls.push(value); },
    },
  });
  return { api: exports, calls };
}

test('开发环境在接口未部署时显示真实店铺资料且标记本地预览', async () => {
  const { api, calls } = loadClient({ error: true });
  const result = await api.loadCatalogue();
  assert.equal(result.source, 'local');
  assert.equal(result.data.store.address, '四河路264号四河小区门口');
  assert.deepEqual(result.data.store.phones, ['15828637898', '18382302879']);
  assert.equal(calls[0].config.env, 'cloud1-d8g6md4r9e96e1f14');
  assert.equal((await api.loadCases()).data.items.length, 0, 'Do not fabricate completed projects');
});

test('正式版本不会把云端错误伪装为本地成功数据', async () => {
  const { api } = loadClient({ release: true, error: true });
  await assert.rejects(api.loadCatalogue(), /not deployed/);
  await assert.rejects(api.loadCases(), /not deployed/);
});

test('有多个联系电话时，按用户选择的号码拨号', async () => {
  const { api, calls } = loadClient();
  await api.contactStore(['15828637898', '18382302879']);
  assert.equal(calls[1].phoneNumber, '18382302879');
});
