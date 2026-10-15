const https = require('node:https');
const { formatStructurePlan } = require('./structure-plan');

function buildPrompt(job) {
  const location = job.inputSnapshot;
  const products = { railings: '栏杆/扶手/护栏', windows: '铝合金门窗', canopies: '雨棚/彩钢房', sunrooms: '阳光房', gates: '拉闸门窗', accessories: '晾衣杆/花架/空调架等金属制品' };
  return [
    '基于这张现场照片，生成写实的定制安装效果预览。保留原有建筑、墙面和洞口。不要改变照片视角，不添加无关家具或人物。',
    '安装位置：' + location.name + '。产品组合：' + location.productTypes.map(type => products[type]).join('、') + '。',
    '工程师已测量尺寸（毫米，仅供方案描述，不作施工图）：' + JSON.stringify(location.dimensions) + '。',
    '主材：' + location.material + '。表面处理：' + (location.finish || '保持材料自然效果') + '。颜色：' + (location.color || '以主材要求为准') + '。',
    '工程师从结构简图转录的关键约束：' + (location.structureNotes || '以下列分面分格方案为准') + '。',
    location.structurePlan ? '工程师已确认的分面分格方案：\n' + formatStructurePlan(location.structurePlan) : '',
    '客户要求：' + (location.customerRequirements || '按工程师结构和材料要求') + '。对应观察角度：' + job.angle + '。',
    '产品数量、分格、连接位置以工程师说明为准。呈现安装后的外观，不自行添加尺寸文字或虚构结构。',
  ].join('\n');
}

function downloadImage(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let target;
    try { target = new URL(url); } catch (_error) { reject(new Error('INVALID_RESULT_URL')); return; }
    if (target.protocol !== 'https:' || redirects > 3 || ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) { reject(new Error('INVALID_RESULT_URL')); return; }
    const request = https.get(target, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        resolve(downloadImage(new URL(response.headers.location, target).href, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error('RESULT_DOWNLOAD_FAILED')); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) { request.destroy(new Error('RESULT_TOO_LARGE')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const jpeg = buffer.length > 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
        if (!png && !jpeg) { reject(new Error('INVALID_RESULT_IMAGE')); return; }
        resolve({ buffer, extension: png ? 'png' : 'jpg' });
      });
      response.on('error', reject);
    });
    request.setTimeout(60000, () => request.destroy(new Error('RESULT_DOWNLOAD_TIMEOUT')));
    request.on('error', reject);
  });
}

async function generate(cloud, job) {
  const reference = await cloud.getTempFileURL({ fileList: [{ fileID: job.sourceFileID, maxAge: 600 }] });
  const source = reference.fileList && reference.fileList[0];
  if (!source || !source.tempFileURL) throw new Error('SOURCE_NOT_ACCESSIBLE');
  const prompt = buildPrompt(job);
  const model = cloud.ai().createImageModel('hunyuan-image');
  const result = await model.generateImage({ model: 'HY-Image-v3.0-I2I-ToB-v1.0.1', prompt, image_urls: [source.tempFileURL], revise: { value: false } });
  if (!result.data || !result.data[0] || !result.data[0].url) throw new Error('EMPTY_GENERATION_RESULT');
  const image = await downloadImage(result.data[0].url);
  return { ...image, prompt, provider: 'cloudbase-hunyuan-i2i', revisedPrompt: result.data[0].revised_prompt || '' };
}

module.exports = { generate, buildPrompt };
