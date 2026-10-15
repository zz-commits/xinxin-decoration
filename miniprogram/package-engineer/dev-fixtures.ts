import type { StructurePlan } from '../models/structure';

export const TEST_PROJECT_TITLE = '开发联调测试项目｜非客户资料';

export function isDevelopmentBuild(): boolean {
  try { return wx.getAccountInfoSync().miniProgram.envVersion === 'develop'; }
  catch (_error) { return false; }
}

export function developmentProjectForm() {
  return { title: TEST_PROJECT_TITLE, customerDisplayName: '联调测试（非客户）', community: '虚构测试场景，无真实地址' };
}

export function developmentLocation(kind: string) {
  if (kind === 'draft') return {
    form: { name: '测试入户雨棚（文字草稿）', material: '测试材质（待确认，非施工规格）', finish: '', color: '', widthMm: '', heightMm: '', depthMm: '', customerRequirements: '仅用于联调清空 / 草稿保存，不含真实客户资料。', structureNotes: '纯文字联调草稿，尺寸、分格与材料尚未确认，不得生成或施工。' },
    structurePlan: { version: 1, faces: [], glass: '', hardware: '', constraints: '' } as StructurePlan,
    productTypes: ['canopies', 'accessories'],
  };
  const canopy = kind === 'canopy';
  const structurePlan: StructurePlan = canopy ? {
    version: 1,
    faces: [{ id: 'test-canopy', name: '雨棚正面（测试）', widthMm: '1800', heightMm: '300', corner: '', obstacles: '测试避让：保留原有管道，不代表现场测量。', cells: [{ id: 'test-roof', name: '整面棚体（测试）', widthMm: '1800', heightMm: '300', opening: 'fixed', direction: '', notes: '仅联调数据，不用于施工。' }] }],
    glass: '', hardware: '测试连接件，非施工规格', constraints: '仅用于联调，不用于生产、安装或客户分享。',
  } : {
    version: 1,
    faces: [
      { id: 'test-front', name: '正面（测试）', widthMm: '2400', heightMm: '2200', corner: '', obstacles: '测试避让：左上角梁位 100 × 100 mm，非实际测量。', cells: [
        { id: 'test-left', name: '左侧固定格（测试）', widthMm: '800', heightMm: '2200', opening: 'fixed', direction: '', notes: '窗与护栏组合，非施工规格。' },
        { id: 'test-middle', name: '中间开启格（测试）', widthMm: '800', heightMm: '2200', opening: 'outward', direction: '从室内看，右侧铰链，向室外开启（测试）', notes: '仅核验开启方向文本保存。' },
        { id: 'test-right', name: '右侧固定格（测试）', widthMm: '800', heightMm: '2200', opening: 'fixed', direction: '', notes: '' },
      ] },
      { id: 'test-side', name: '左侧转角面（测试）', widthMm: '900', heightMm: '2200', corner: '从室内看，与正面左端成 90° 转角（测试）', obstacles: '', cells: [{ id: 'test-side-fixed', name: '侧面固定格（测试）', widthMm: '900', heightMm: '2200', opening: 'fixed', direction: '', notes: '' }] },
    ],
    glass: '测试玻璃配置，非客户选材', hardware: '测试执手与铰链，非客户选型', constraints: '仅用于联调，不用于生产、安装或客户分享；保留虚构梁位。',
  };
  return {
    form: { name: canopy ? '测试入户雨棚' : '测试转角阳台', material: canopy ? '测试材质：棚板与金属支架，非施工规格' : '测试材质：铝合金窗框与不锈钢栏杆，非施工规格', finish: '测试表面处理', color: '测试颜色（非客户指定）', widthMm: canopy ? '1800' : '2400', heightMm: canopy ? '300' : '2200', depthMm: '900', customerRequirements: '仅用于功能联调，不含真实客户资料。', structureNotes: '虚构的结构样例，不对应已收到的参考图片。' },
    structurePlan,
    productTypes: canopy ? ['canopies', 'accessories'] : ['windows', 'railings'],
  };
}
