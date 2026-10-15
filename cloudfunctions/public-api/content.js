const safeText = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max) : '';
const strings = (value, max = 30) => Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, max).map(item => item.slice(0, 300)) : [];
const publicImage = value => typeof value === 'string' && /^cloud:\/\/[^/]+\/public\//.test(value) ? value : '';

function cleanService(row) {
  return { _id: row._id, title: safeText(row.title, 80), subtitle: safeText(row.subtitle, 120), description: safeText(row.description), products: strings(row.products), materials: strings(row.materials), variant: ['railing', 'window', 'canopy', 'sunroom', 'gate', 'accessory'].includes(row.variant) ? row.variant : 'railing', sortOrder: Number(row.sortOrder) || 0 };
}

function cleanStore(row) {
  return { _id: 'main', name: safeText(row.name, 80), branchName: safeText(row.branchName, 80), description: safeText(row.description), phones: strings(row.phones, 5).filter(phone => /^[0-9+\- ]{5,25}$/.test(phone)), wechatId: safeText(row.wechatId, 80), wechatQrImage: publicImage(row.wechatQrImage), address: safeText(row.address, 300), businessHours: safeText(row.businessHours, 150), dianpingUrl: /^https:\/\/m\.dianping\.com\//.test(row.dianpingUrl || '') ? safeText(row.dianpingUrl, 1000) : '' };
}

function cleanCase(row) {
  return { _id: row._id, title: safeText(row.title, 120), summary: safeText(row.summary), community: safeText(row.community, 100), categoryIds: strings(row.categoryIds, 10), coverImage: publicImage(row.coverImage), images: strings(row.images, 30).map(publicImage).filter(Boolean), locations: (Array.isArray(row.locations) ? row.locations : []).slice(0, 30).filter(item => item && typeof item === 'object').map(item => ({ name: safeText(item.name, 80), products: strings(item.products, 20), material: safeText(item.material, 300) })) };
}

function createHandler(db) {
  return async function handle(event = {}) {
    const payload = event.payload || {};
    if (event.action === 'getCatalogue') {
      const [stores, services] = await Promise.all([
        db.collection('store_config').where({ _id: 'main', status: 'published' }).limit(1).get(),
        db.collection('services').where({ status: 'published' }).orderBy('sortOrder', 'asc').limit(50).get(),
      ]);
      if (!stores.data.length) return { ok: false, code: 'CONTENT_NOT_INITIALIZED', message: '店铺资料尚未发布。' };
      return { ok: true, data: { store: cleanStore(stores.data[0]), services: services.data.map(cleanService) } };
    }
    if (event.action === 'listCases') {
      const page = payload.page === undefined ? 0 : payload.page;
      if (!Number.isInteger(page) || page < 0 || page > 100 || (payload.categoryId && !/^[a-z0-9-]{1,60}$/.test(payload.categoryId))) return { ok: false, code: 'INVALID_ARGUMENT', message: '案例查询参数不正确。' };
      const where = { status: 'published' };
      if (payload.categoryId) where.categoryIds = db.command.all([payload.categoryId]);
      const rows = await db.collection('cases').where(where).orderBy('publishedAt', 'desc').skip(page * 12).limit(13).get();
      return { ok: true, data: { items: rows.data.slice(0, 12).map(cleanCase), hasMore: rows.data.length > 12 } };
    }
    if (event.action === 'getCase') {
      if (typeof payload.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(payload.id)) return { ok: false, code: 'INVALID_ARGUMENT', message: '案例 ID 不正确。' };
      const rows = await db.collection('cases').where({ _id: payload.id, status: 'published' }).limit(1).get();
      return { ok: true, data: rows.data.length ? cleanCase(rows.data[0]) : null };
    }
    return { ok: false, code: 'INVALID_ACTION', message: '不支持的操作。' };
  };
}

module.exports = { createHandler, cleanStore, cleanService, cleanCase };
