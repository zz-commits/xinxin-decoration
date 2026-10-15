const crypto = require('node:crypto');

function createHandler(cloud, db) {
  return async function handle(code) {
    if (typeof code !== 'string' || !/^[a-f0-9]{48}$/.test(code)) return null;
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    const rows = await db.collection('share_links').where({ _id: hash, status: 'active' }).limit(1).get();
    const share = rows.data[0];
    if (!share || !share.expiresAt || share.expiresAt <= new Date().toISOString()) return null;
    const snapshot = share.snapshot;
    const ids = snapshot.locations.flatMap(location => location.images.map(image => image.assetId));
    const allowed = new Set();
    for (let i = 0; i < ids.length; i += 50) {
      const current = await db.collection('assets').where({ _id: db.command.in(ids.slice(i, i + 50)), projectId: share.projectId, type: 'generated_image', reviewStatus: 'approved', status: 'ready' }).limit(50).get();
      for (const asset of current.data) allowed.add(asset._id + '\n' + asset.fileID);
    }
    const fileIDs = snapshot.locations.flatMap(location => location.images.filter(image => allowed.has(image.assetId + '\n' + image.fileID)).map(image => image.fileID));
    const urls = new Map();
    for (let i = 0; i < fileIDs.length; i += 50) {
      const resolved = await cloud.getTempFileURL({ fileList: fileIDs.slice(i, i + 50).map(fileID => ({ fileID, maxAge: 600 })) });
      for (const item of resolved.fileList || []) if (item.tempFileURL) urls.set(item.fileID, item.tempFileURL);
    }
    // 返回白名单字段，不暴露原始资料、尺寸、提示词、工程师备注或存储 ID。
    const locations = snapshot.locations.map(location => ({ id: location._id, name: location.name, productTypes: location.productTypes, material: location.material, finish: location.finish, color: location.color, images: location.images.filter(image => allowed.has(image.assetId + '\n' + image.fileID) && urls.has(image.fileID)).map(image => ({ angle: image.angle, url: urls.get(image.fileID) })) })).filter(location => location.images.length);
    return locations.length ? { title: snapshot.title, customerDisplayName: snapshot.customerDisplayName, locations, disclaimer: snapshot.disclaimer, expiresAt: share.expiresAt } : null;
  };
}

module.exports = { createHandler };
