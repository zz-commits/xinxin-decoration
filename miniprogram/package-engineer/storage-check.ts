import { engineerRequest } from '../services/engineer-api';

// Only called by the guarded, explicitly confirmed development-test project action.
// No model calls, no customer files, no tokens or signed URLs in the report.
async function mustBeDenied(operation: () => Promise<unknown>, label: string) {
  try { await operation(); }
  catch (error) {
    const detail = error as any;
    const code = String(detail.errCode || detail.code || '');
    const message = code + ' ' + String(detail.errMsg || detail.message || '');
    if (code === '-503002' || /\bSTORAGE_EXCEED_AUTHORITY\b|permission[ _-]?denied|access[ _-]?denied|unauthorized|无权限|权限不足|没有权限|have no access right to the storage/i.test(message)) return label + '：已拒绝';
    const safeDetail = message.replace(/https?:\/\/\S+/gi, '[链接]').replace(/cloud:\/\/\S+/gi, '[文件]').replace(/o[A-Za-z0-9_-]{27}/g, '[身份]').slice(0, 240);
    throw new Error(label + '：未得到明确权限拒绝，请检查网络或平台错误。\n' + (safeDetail.trim() || 'SDK 未返回错误详情'));
  }
  throw new Error(label + '：意外允许访问，权限验证失败。请暂停客户资料上传并检查规则。');
}

async function readCloudFile(fileID: string) {
  try { return await wx.cloud.downloadFile({ fileID }); }
  catch (error) {
    const detail = error as any;
    // Some WeChat base libraries hide a rejected URL lookup behind this generic
    // download error. Inspect the per-file result; an empty URL alone proves nothing.
    if (String(detail.errCode || detail.code) !== '-403003' || !/empty download url/i.test(String(detail.errMsg || detail.message || ''))) throw error;
    const result = await wx.cloud.getTempFileURL({ fileList: [fileID] });
    const row = result.fileList.find(item => item.fileID === fileID);
    if (!row) throw new Error('逐文件读取结果缺失，不能完成验证。');
    if (row.tempFileURL) return row;
    if (row.status === 0) throw new Error('下载链接为空，但逐文件读取状态为成功，不能完成验证。');
    throw { errCode: row.status, errMsg: row.errMsg || '逐文件读取失败，未返回具体原因。' };
  }
}

export async function checkPrivateStorage(projectId: string, locationId: string) {
  const fs = wx.getFileSystemManager();
  const filePath = wx.env.USER_DATA_PATH + '/non-customer-storage-test.png';
  fs.writeFileSync(filePath, fs.readFileSync('/package-engineer/fixtures/non-customer-storage-test.png') as ArrayBuffer);
  const ticket = await engineerRequest('prepareUpload', { projectId, locationId, type: 'material_reference', extension: 'png' });
  const steps: string[] = [];
  steps.push(await mustBeDenied(() => wx.cloud.uploadFile({ cloudPath: 'private/projects/' + projectId + '/storage-probe-' + ticket.assetId + '.png', filePath }), '客户端直写私有目录'));
  const uploaded = await wx.cloud.uploadFile({ cloudPath: ticket.cloudPath, filePath });
  steps.push('白名单工程师上传中转目录：成功');
  steps.push(await mustBeDenied(() => readCloudFile(uploaded.fileID), '客户端直读中转文件'));
  await engineerRequest('finalizeUpload', { projectId, assetId: ticket.assetId, fileID: uploaded.fileID });
  steps.push('云函数校验并转存：成功');
  const privateFileID = uploaded.fileID.slice(0, uploaded.fileID.indexOf('/uploads/')) + '/private/projects/' + projectId + '/source/' + ticket.assetId + '.png';
  steps.push(await mustBeDenied(() => readCloudFile(privateFileID), '客户端直读私有文件'));
  const result = await engineerRequest('getProject', { projectId });
  const asset = result.assets.find((item: any) => item._id === ticket.assetId);
  if (!asset || !asset.previewUrl) throw new Error('转存后未获得本人项目的授权预览。');
  const image = await wx.getImageInfo({ src: asset.previewUrl });
  if (image.width !== 320 || image.height !== 200) throw new Error('授权预览未读到预期测试图片。');
  steps.push('工程师授权预览：320 × 200，读取成功');
  return steps;
}
