# 鑫新装饰微信小程序技术设计与实施方案

> 文档版本：V0.3  
> 更新日期：2026-10-15  
> 关联文档：[产品设计方案](./product-design.md)  
> 目标平台：微信小程序 + 微信云开发 CloudBase

## 当前实现与设计蓝图的区别

首版代码已完成公共展示、工程师项目 / 安装位置、资料上传、单图 I2I 任务、人工审核和专属分享。实际部署步骤、字段、规则文件与未完成事项以 [首版部署与验收指南](./deployment.md) 为准。

本文件仍保留后续扩展的设计蓝图，不能把所有设计字段和服务视为已实现。当前收敛如下：

- 实际云函数为 `healthcheck`、`public-api`、`engineer-api`、`share-api`、`generation-worker`；生成、审核、创建 / 停用分享都收敛到 `engineer-api`。没有独立 `generation-api`、`generation-sync` 或自动清理函数。
- 所有数据库客户端直读直写均关闭，公共内容也走 `public-api`；当前不需要 `service_categories`。
- 用户文档 `_id` 直接使用 OPENID；日期使用 UTC ISO 字符串；分享随机码哈希直接作为文档 `_id`，冻结只读快照。工程师角色仅管理自己的项目，管理员可管理全部项目。
- 上传使用工程师 OPENID 存储白名单 + `wx.cloud.uploadFile` 中转 + 服务端登记转存，不是短时签名上传。人员停用必须同时移除存储名单。
- AI 使用 `wx-server-sdk: 4.0.2`，一张现场照片对应一角度；结构简图 / 材质参考归档，关键要求由工程师转录为文字。多参考图自动理解、视频、像素级水印、运营管理后台和自动清理属于后续工作。
- 安装位置的 `structurePlan` 已支持最多 6 面、每面 12 格，以及尺寸、转角、开启方式 / 方向、避让、玻璃、五金和禁止改变项。生成前通过 `getGenerationPreview` 只读核对，再由 `createGeneration` 校验当前摘要和四项确认、冻结输入。详见部署指南中的结构兼容说明及 [领域术语](../CONTEXT.md)。
- 当前仅配置用户已开通的 `cloud1`；生产环境隔离仍是上线前建议，并未自动新建环境。`healthcheck` 和公共资料读取、未授权身份查询已通过；三个业务函数和 11 个集合已部署。私有上传被当前套餐的规则变更限制阻挡，未升级、未启用 Worker。逐项实际状态见 [联调记录](./development-progress-2026-10-15.md)。

## 1. 技术结论

首版采用以下架构：

- **客户端：** 微信原生小程序，TypeScript + WXML + WXSS。
- **身份链路：** 微信云开发原生 `wx.cloud`，不自建登录、不维护 Token。
- **后端：** 微信云开发事件云函数，目标 Node.js 20.19；当前 CLI 实际创建为 Node.js 16.13，需在正式上线前确认迁移方式。
- **数据库：** CloudBase 文档型数据库。
- **文件：** CloudBase 云存储，公共素材与项目私有素材分区管理。
- **AI：** 云函数服务端调用 CloudBase AI / 腾讯云生图服务，使用可替换的 Provider 适配层。
- **异步任务：** 数据库任务队列 + 定时触发云函数，不部署常驻服务器。
- **发布：** 开发与生产两个 CloudBase 环境，使用微信开发者工具和 CloudBase CLI 部署。

这套方案不需要购买或维护独立服务器，所有长期运行能力都由云函数、定时触发器、数据库和云存储承担。

## 2. 架构选型决策

### 2.1 为什么采用原生微信小程序

首版选择原生小程序，而不是 Taro、uni-app 或 WebView：

- 与 `wx.cloud`、微信分享、拨号、图片选择和云存储能力直接集成。
- 减少框架适配层和小程序审核阶段的兼容风险。
- 更容易控制主包体积，并把工程师工作台放入独立分包。
- 当前页面规模有限，不需要跨端框架带来的额外复杂度。

### 2.2 为什么使用文档型数据库

项目、安装位置、生成批次和图片资源天然是 JSON 层级数据，文档型数据库更适合首版快速迭代。需要跨集合一致性的关键操作，例如“确认效果图并创建分享版本”，在服务端使用事务完成。

首版不选择 PostgreSQL/MySQL，避免引入关系模型、迁移和额外运维；当未来出现报价单、合同、支付或复杂统计时，再评估关系数据库。

### 2.3 为什么不使用云托管

当前业务量低、请求以事件驱动为主，没有常驻连接和长时间 Web 服务需求，普通事件云函数足够。只有出现以下情况时才考虑升级到云托管：

- AI 工作流需要常驻队列消费者；
- 需要接入只能通过 HTTP 回调的复杂第三方系统；
- 云函数执行时长、并发或依赖体积成为明显瓶颈；
- 后续新增 Web 管理后台并需要统一 API 服务。

## 3. 微信云开发合规边界

### 3.1 只使用一条身份链路

本项目采用微信云开发原生链路：

```text
微信小程序
→ wx.cloud.init
→ wx.cloud.callFunction
→ wx-server-sdk / getWXContext
→ OPENID
```

不在小程序端引入另一套 `@cloudbase/js-sdk` 自定义登录流程，也不自行调用 `wx.login` 换取业务 Token。官方文档明确说明，这两套链路不应混用。

小程序 AppID 必须分别关联开发和生产 CloudBase 环境，否则数据库、存储和云函数调用都会失败。

参考：[在微信小程序中调用 CloudBase 云函数](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)

### 3.2 事件云函数而非公网 HTTP 接口

小程序调用后端统一使用 `wx.cloud.callFunction`：

- 无需配置业务 HTTPS 域名。
- 云函数自动获得可信 `OPENID`。
- 工程师权限在云函数内部再次校验。
- 不把腾讯云密钥、AI Key 或管理员凭证下发到客户端。

面向小程序的函数使用事件触发，不配置成仅 HTTP 触发的函数；HTTP 调用不会自动获得同样的微信身份上下文。

### 3.3 图片不通过云函数参数传输

`wx.cloud.callFunction` 的事件数据存在大小限制，因此现场照片、结构简图和材质图片必须先上传云存储，云函数只接收 `fileID`、资源 ID 和结构化文本，不能传 Base64 大图。

### 3.4 AI 只能在服务端调用

CloudBase 生图能力由服务端调用。首版独立 AI Worker 与其他业务函数统一使用官方已支持生图的 `wx-server-sdk: 4.0.2`，通过 `cloud.ai().createImageModel('hunyuan-image')` 调用；客户端只创建任务和读取状态，不引入通用 Node SDK 或 AI 凭据。

官方当前说明：

- `wx-server-sdk` 使用 4.0.2 或更高版本，当前代码锁定 4.0.2；
- 生图耗时较长，AI 工作函数超时时间建议配置到 900 秒；
- 生成图片 URL 约 24 小时后失效，必须及时转存云存储；
- CloudBase 混元 I2I 当前最多输入 1 张垫图，单图不超过 10MB。

参考：[CloudBase AI wx-server-sdk 生图](https://docs.cloudbase.net/ai/image-model/wx-server-sdk)。AI Provider 继续独立封装，便于质量验证后替换模型，不影响业务鉴权和分享逻辑。

## 4. 总体架构

```text
┌──────────────────────────────────────────────┐
│                 微信原生小程序                 │
│                                              │
│  公共主包                 工程师分包            │
│  首页/业务/案例/联系       项目/资料/生成/审核     │
│  专属分享页                                    │
└───────────────┬──────────────────────────────┘
                │ wx.cloud / fileID
                ▼
┌──────────────────────────────────────────────┐
│                CloudBase 云函数               │
│                                              │
│ public-api       engineer-api     share-api   │
│ generation-api   generation-worker            │
│ generation-sync  maintenance                  │
└───────┬───────────────────┬──────────────────┘
        │                   │
        ▼                   ▼
┌───────────────┐     ┌────────────────────────┐
│ 文档型数据库    │     │ CloudBase 云存储        │
│ 项目/任务/权限  │     │ 公共案例/私有资料/结果图 │
└───────┬───────┘     └───────────┬────────────┘
        │                           │
        └──────────┬────────────────┘
                   ▼
        ┌─────────────────────────┐
        │ AI Provider 适配层       │
        │ CloudBase 混元 I2I       │
        │ 腾讯云 MPS AIGC（候选）   │
        └─────────────────────────┘
```

## 5. 小程序端设计

### 5.1 包结构

```text
miniprogram/
├── app.ts
├── app.json
├── app.wxss
├── pages/
│   ├── home/
│   ├── services/
│   ├── service-detail/
│   ├── cases/
│   ├── case-detail/
│   ├── contact/
│   └── project-share/
├── package-engineer/
│   ├── project-list/
│   ├── project-detail/
│   ├── location-edit/
│   ├── asset-upload/
│   ├── generation-create/
│   ├── generation-review/
│   └── share-settings/
├── components/
│   ├── service-card/
│   ├── case-card/
│   ├── image-uploader/
│   ├── material-summary/
│   ├── generation-status/
│   └── ai-disclaimer/
├── services/
│   ├── cloud.ts
│   ├── public-api.ts
│   ├── engineer-api.ts
│   └── share-api.ts
├── models/
├── utils/
└── config/
    ├── dev.ts
    └── prod.ts
```

公共展示页面保留在主包，工程师工作台使用分包，避免后台功能拖慢普通顾客首次打开速度。

### 5.2 页面数据访问方式

| 数据 | 访问方式 | 原因 |
| --- | --- | --- |
| 已发布业务分类 | `public-api` | 仅服务端返回发布字段 |
| 已发布成功案例 | `public-api` | 避免泄露草稿或私有文件 |
| 店铺公开信息 | `public-api` | 统一字段白名单 |
| 工程项目 | `engineer-api` | 需要工程师角色校验 |
| 原始现场资料 | 云函数签发临时访问地址 | 私有文件，不允许公共读取 |
| AI 任务与结果 | `engineer-api` | 需要权限和状态约束 |
| 专属项目预览 | `share-api` | 只返回指定分享版本的数据 |

首版所有内容通过统一服务层和云函数读取，页面不直接访问数据库。

### 5.3 状态管理

首版不引入大型状态管理库：

- 页面状态使用小程序 `Page.data`；
- 当前工程师身份和环境信息放在 `App.globalData`；
- API 请求、错误格式和加载状态由 `services/` 统一封装；
- 项目编辑页按步骤保存草稿，不维护超大的跨页内存对象。

## 6. 云函数设计

### 6.1 函数边界

| 云函数 | 调用方 | 职责 |
| --- | --- | --- |
| `public-api` | 所有用户 | 首页、业务、案例、店铺信息 |
| `engineer-api` | 工程师 | 项目、位置、上传登记、生成、审核、创建 / 停用分享 |
| `generation-worker` | 定时触发 | 领取排队任务、调用同步生图服务 |
| `share-api` | 微信访客 + 有效随机码 | 只读访问审核快照 |
| `healthcheck` | 微信访客 | 检查环境和微信身份链路 |

异步 Provider 的 `generation-sync` 和自动清理 `maintenance` 尚未实现。

每个面向客户端的函数采用 `action` 分发模式，例如：

```ts
wx.cloud.callFunction({
  name: 'engineer-api',
  data: {
    action: 'saveLocation',
    payload: { projectId, locationId, location }
  }
})
```

函数入口统一完成：

1. 读取可信 `OPENID`；
2. 验证工程师角色；
3. 校验 `action` 和输入结构；
4. 执行业务服务；
5. 返回统一结果或错误码；
6. 写入必要的审计日志。

### 6.2 运行时

- 普通业务函数：Node.js 20.19，建议超时 10–30 秒。
- AI 同步工作函数：Node.js 20.19，超时最高配置为 900 秒。
- 定时同步函数：根据每批处理量配置 60–300 秒。
- 所有依赖锁定版本并提交 `package-lock.json`。

Node.js 20.19 属于 CloudBase 当前支持的运行时，兼顾稳定性和较新的 SDK 能力。参考：[CloudBase 云函数运行环境支持](https://docs.cloudbase.net/cloud-function/runtime-support)

### 6.3 统一返回格式

```ts
type ApiResult<T> =
  | { ok: true; data: T; requestId?: string }
  | { ok: false; code: string; message: string; requestId?: string };
```

建议的业务错误码：

- `UNAUTHORIZED`
- `ENGINEER_REQUIRED`
- `PROJECT_NOT_FOUND`
- `ASSET_NOT_READY`
- `INVALID_PROJECT_STATE`
- `GENERATION_QUOTA_EXCEEDED`
- `GENERATION_FAILED`
- `SHARE_LINK_INVALID`
- `SHARE_LINK_EXPIRED`

## 7. 数据库设计

### 7.1 集合

#### `users`

```ts
{
  _id: string,
  openid: string,
  name: string,
  role: 'engineer' | 'admin',
  status: 'active' | 'disabled',
  createdAt: Date,
  updatedAt: Date
}
```

索引：`openid` 唯一索引、`status + role` 组合索引。

#### `projects`

```ts
{
  _id: string,
  projectNo: string,
  title: string,
  customerDisplayName: string,
  community: string,
  status: 'draft' | 'collecting' | 'generating' | 'reviewing' | 'shareable' | 'archived',
  ownerOpenid: string,
  collaboratorOpenids: string[],
  latestShareVersion: number,
  createdAt: Date,
  updatedAt: Date
}
```

不在项目中保存完整身份证件或不必要的个人信息。顾客端显示名称使用“张女士”等最小必要信息。

索引：`ownerOpenid + updatedAt`、`status + updatedAt`、`projectNo` 唯一索引。

#### `project_locations`

```ts
{
  _id: string,
  projectId: string,
  name: string,
  order: number,
  productTypes: string[],
  dimensions: {
    widthMm?: number,
    heightMm?: number,
    depthMm?: number,
    notes?: string
  },
  materialRequirements: {
    primaryMaterial: string,
    grade?: string,
    finish?: string,
    color?: string,
    glass?: string,
    hardware?: string
  },
  customerRequirements: string,
  engineerNotes: string,
  status: 'draft' | 'ready' | 'generating' | 'reviewing' | 'approved',
  createdAt: Date,
  updatedAt: Date
}
```

索引：`projectId + order`、`projectId + status`。

#### `assets`

```ts
{
  _id: string,
  projectId: string,
  locationId?: string,
  type: 'site_photo' | 'sketch' | 'material_reference' | 'generated_image' | 'generated_video',
  angle?: string,
  fileID: string,
  mimeType: string,
  size: number,
  width?: number,
  height?: number,
  ownerOpenid: string,
  visibility: 'private' | 'share_version' | 'public_case',
  auditStatus: 'pending' | 'approved' | 'rejected',
  createdAt: Date
}
```

索引：`projectId + locationId + type`、`visibility + auditStatus`。

#### `generation_batches`

```ts
{
  _id: string,
  projectId: string,
  locationId: string,
  version: number,
  provider: string,
  inputSnapshot: object,
  requestedAngles: string[],
  status: 'queued' | 'running' | 'reviewing' | 'approved' | 'partial_failed' | 'failed',
  createdBy: string,
  createdAt: Date,
  updatedAt: Date
}
```

`inputSnapshot` 保存生成当时的结构化要求摘要，避免项目内容后来变化后无法解释旧结果。

#### `generation_jobs`

```ts
{
  _id: string,
  batchId: string,
  projectId: string,
  locationId: string,
  angle: string,
  status: 'queued' | 'claimed' | 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled',
  provider: string,
  providerJobId?: string,
  sourceAssetId: string,
  prompt: string,
  revisedPrompt?: string,
  outputAssetId?: string,
  attempts: number,
  lockedAt?: Date,
  lockedBy?: string,
  errorCode?: string,
  errorMessage?: string,
  createdAt: Date,
  updatedAt: Date
}
```

索引：`status + createdAt`、`batchId + angle`、`providerJobId`。

#### `render_reviews`

```ts
{
  _id: string,
  assetId: string,
  projectId: string,
  locationId: string,
  decision: 'approved' | 'rejected',
  checklist: {
    structureCorrect: boolean,
    productCountCorrect: boolean,
    materialCorrect: boolean,
    colorCorrect: boolean,
    crossAngleConsistent: boolean
  },
  note?: string,
  reviewedBy: string,
  reviewedAt: Date
}
```

#### `share_links`

```ts
{
  _id: string,
  codeHash: string,
  projectId: string,
  version: number,
  approvedAssetIds: string[],
  status: 'active' | 'disabled' | 'expired',
  expiresAt?: Date,
  createdBy: string,
  createdAt: Date,
  disabledAt?: Date
}
```

分享链接中携带高强度随机 `code`，数据库只保存摘要 `codeHash`。分享记录冻结当时允许展示的效果图列表，避免新生成但未审核的图片自动进入旧链接。

#### 公共内容集合

- `service_categories`
- `services`
- `cases`
- `store_config`

公共内容统一包含 `status: 'draft' | 'published'`、`sortOrder`、`publishedAt` 和更新时间。

### 7.2 数据库权限

当前实施规则：

- 公共内容：客户端禁止直接读写，`public-api` 只查询 `status: 'published'`，返回白名单字段。
- 项目相关集合：客户端全部禁止直接读写，仅服务端访问。
- `users`：客户端禁止直接读写。
- 生成任务、审核、分享：全部经云函数。

模板见 `cloudbase/rules/server-only.json`。后续若改为客户端直读，需重新设计查询与规则匹配并完成权限测试。参考：[CloudBase 数据库安全规则](https://docs.cloudbase.net/database/security-rules)

## 8. 云存储设计

### 8.1 路径规范

```text
public/
├── services/
├── cases/
└── store/

uploads/
└── {openid}/
    └── {projectId}/
        └── {uuid}.{ext}

private/
└── projects/
    └── {projectId}/
        ├── source/
        ├── renders/{batchId}/
        └── videos/{batchId}/
```

### 8.2 上传流程

```text
工程师选择图片
→ 客户端检查格式、尺寸和大小
→ 调用 engineer-api.prepareUpload
→ 云函数验证工程师身份和项目权限
→ 云函数创建上传任务，返回随机对象路径
→ 存储白名单身份使用 wx.cloud.uploadFile 上传到 uploads/{openid}/...
→ 调用 engineer-api.finalizeUpload(projectId, assetId, fileID)
→ 云函数再次校验项目、文件路径、格式与大小
→ 转存到 private/，将 assets 更新为 ready，尽力清理中转文件
→ 后续由服务端处理、生成临时访问 URL
```

当前必须在存储规则中显式枚举工程师身份，普通顾客不能上传。客户端不能自行把资源标记为“审核通过”或“客户可见”。未来扩展为多人管理时，可评估短时签名上传以减少存储名单维护，但不能在迁移前放宽当前规则。

### 8.3 存储权限建议

- `public/`：所有用户可读，客户端不可写。
- `uploads/`：不公开读取；仅显式授权的工程师创建者可写。
- `private/`：客户端不可直接读写，仅云函数访问。
- 工程师和客户查看私有图片时，由云函数校验权限后返回短期临时地址。
- 限制允许上传的图片类型与大小，清理未完成登记的临时文件。

云存储安全规则支持按创建者和路径控制访问，服务端不受客户端安全规则限制；CloudBase 也提供签名上传 URL 能力，适合大文件的受控直传。参考：[CloudBase 云存储安全规则](https://docs.cloudbase.net/storage/security-rules)、[签名上传 URL](https://docs.cloudbase.net/api-reference/webv3/storage)

## 9. AI 生成方案

### 9.1 首版生成原则

AI 的权威输入顺序为：

以下为完整输入蓝图。当前单图 I2I 只接收第 2 项现场照片与工程师填写文字，第 3、4 项必须先由工程师转录关键约束，不能声称已自动解析或同时传入多参考图。

1. 工程师结构化填写的产品、材料、颜色和禁止改变项；
2. 对应角度的现场照片；
3. 工程师结构简图；
4. 材质或样式参考图；
5. AI 自动补充的提示词。

模型不得自行覆盖工程师填写的结构化要求。AI 图片仅是沟通预览，不用于尺寸确认或施工放样。

### 9.2 多角度策略

为提高一致性，首版要求工程师尽量为每个目标角度提供对应的现场照片：

| 目标效果角度 | 推荐基础图 |
| --- | --- |
| 正面整体 | 正面现场照片 |
| 左侧斜视 | 左侧现场照片 |
| 右侧斜视 | 右侧现场照片 |
| 室内向外 | 室内拍摄照片 |
| 室外向内 | 室外拍摄照片 |

系统对每个角度分别创建生成任务，但共享同一份项目、产品组合和材质快照。若没有对应角度的现场照片，可以生成“推测视角”，但必须在工程师端标记为低置信度，不建议直接分享。

### 9.3 Provider 适配层

```ts
interface ImageGenerationProvider {
  submit(input: GenerationInput): Promise<
    | { mode: 'completed'; outputUrls: string[]; metadata: object }
    | { mode: 'async'; providerJobId: string }
  >;

  query?(providerJobId: string): Promise<ProviderJobResult>;
}
```

首版保留两个实现方向：

#### 方案 A：CloudBase 混元 I2I

优点：

- 与 CloudBase Node SDK 集成简单；
- 不需要小程序直连第三方域名；
- 服务端可直接保存到云存储；
- 适合使用一张现场图做效果编辑的首轮验证。

限制：

- 当前 I2I 一次最多输入 1 张垫图；
- 现场照片、结构简图和材质图无法在一次请求中全部作为图像输入；
- 多角度结构一致性仍需人工审核。

#### 方案 B：腾讯云 MPS AIGC

优点：

- 使用异步任务接口，更适合任务队列；
- 聚合多个图生图和参考图编辑模型；
- 可根据模型能力选择更适合多参考图的版本。

限制：

- 具体模型的多图输入、费用和效果必须实测；
- 返回资源只有约 12 小时有效，必须自动转存；
- 需要云函数中配置腾讯云 API 鉴权和并发控制。

参考：[腾讯云 MPS AI 图片生成](https://cloud.tencent.com/document/product/862/132095)

### 9.4 推荐决策

**应用架构确定使用 Provider 适配层，生产模型在开发前置验证后锁定。**

前置验证按以下顺序执行：

1. 使用真实项目的现场照片、结构简图、材料要求建立 3 组样本。
2. 先验证 CloudBase 混元 I2I 的单图编辑效果。
3. 再验证腾讯云 MPS 中支持参考图编辑或多图输入的模型。
4. 对比结构保持、材质准确、跨角度一致性、生成时间和单图成本。
5. 如果 CloudBase I2I 能满足首版质量要求，则优先使用方案 A；否则生产使用方案 B，方案 A 作为降级能力。

这一决策不能只看模型宣传，需要用鑫新装饰真实照片和工程简图进行验证。

### 9.5 AI 任务队列

```text
工程师创建生成批次
→ generation-api 校验资料完整性
→ 事务写入 batch + 多个 angle jobs
→ generation-worker 定时领取 queued 任务
→ 短事务完成任务锁定
→ 事务外调用 AI
→ 同步结果：立即转存云存储
→ 异步结果：保存 providerJobId
→ generation-sync 轮询异步任务
→ 转存结果并更新为 succeeded
→ 所有角度完成后批次进入 reviewing
```

外部 AI 调用不能放在数据库事务中。事务只负责领取任务、状态切换和必要的原子更新。

CloudBase 支持定时触发云函数，可用于队列消费和结果同步。参考：[CloudBase 云函数](https://docs.cloudbase.net/cloud-function/develop)

### 9.6 重试与幂等

- 每个任务使用唯一 `_id` 和 `idempotencyKey`。
- `queued → claimed` 使用事务抢占，避免多个定时函数重复处理。
- `lockedAt` 超过阈值的任务可被维护函数重新入队。
- 网络错误、限流和暂时性错误最多自动重试 2 次。
- 内容审核失败、输入不合法或余额不足不自动重试。
- 已成功并转存的结果不得因重复回调再次创建资产。

## 10. 审核与分享设计

### 10.1 工程师审核清单

确认按钮只有在以下项目全部勾选后可用：

- 产品种类和数量正确；
- 结构位置与简图大致一致；
- 材料和表面处理正确；
- 颜色符合客户要求；
- 多角度之间没有明显冲突；
- 图片中没有异常文字、结构或无关物体；
- 已显示 AI 效果预览标识。

### 10.2 分享版本

创建分享时生成不可变的“分享版本”：

- 指定项目与版本号；
- 指定允许展示的安装位置；
- 指定已审核图片 ID；
- 设置有效期；
- 生成可随时停用的随机分享码。

客户通过以下页面进入：

```text
/pages/project-share/index?code={randomCode}
```

`share-api` 校验分享码、状态和有效期，只返回：

- 项目展示名称；
- 安装位置与产品组合摘要；
- 已审核效果图的短期访问地址；
- 材料与颜色摘要；
- 免责声明和联系方式。

不返回客户电话、详细尺寸、原始现场照片、结构简图、工程师备注、提示词和失败任务。

## 11. 安全与隐私

### 11.1 权限原则

- 隐藏工程师入口不是安全措施，所有后台动作必须服务端校验角色。
- 默认拒绝项目集合和私有文件的客户端访问。
- 分享链接只允许读取冻结后的审核版本。
- 云函数输入全部进行结构和长度校验。
- AI 与腾讯云凭证只放在云函数环境变量或平台密钥配置中。
- 日志中不得打印完整客户电话、分享码、临时文件 URL 或密钥。

CloudBase 云函数安全规则只能做粗粒度调用限制，更细的工程师角色检查应在函数内部实现。参考：[CloudBase 云函数安全规则](https://docs.cloudbase.net/cloud-function/security-rules)

### 11.2 最小化个人信息

- 项目仅保存业务所需的客户称呼、所在小区和工程沟通信息。
- 不收集身份证、精确定位等无关信息。
- 客户页面不建设复杂账户，不要求手机号授权。
- 项目归档后提供删除或脱敏机制。
- 上线前完成小程序隐私声明、数据用途说明和访问权限核查。

### 11.3 内容与 AI 标识

- 所有 AI 生成图片增加“AI 效果预览”可见标识。
- 客户页面固定显示：

> AI 效果预览图，仅用于方案沟通与展示；颜色、材质、比例及细节可能存在偏差，最终结果以实际施工和安装效果为准。

- 公开案例发布前由管理员审核图片版权、客户隐私和展示范围。

## 12. 环境与配置

### 12.1 环境划分

| 环境 | 用途 | 数据 |
| --- | --- | --- |
| `dev` | 日常开发、AI 测试、模拟项目 | 测试数据 |
| `prod` | 正式小程序 | 真实业务数据 |

开发和生产使用不同：

- CloudBase 环境 ID；
- 数据库集合；
- 云存储；
- AI 配额与密钥；
- 分享链接；
- 日志与告警。

云函数使用动态当前环境或环境变量，禁止在业务代码中硬编码生产环境 ID。

### 12.2 配置项

- `ENV_ID`
- `APP_ENV`
- `AI_PROVIDER`
- `AI_MODEL`
- `AI_MAX_CONCURRENCY`
- `UPLOAD_MAX_BYTES`
- `SHARE_DEFAULT_TTL_DAYS`
- 腾讯云 API 凭证或 CloudBase API Key（仅服务端）

## 13. 可观测性与费用控制

### 13.1 日志

每个请求记录：

- `requestId`
- 云函数名和 action
- 调用者角色，不记录完整敏感信息
- 项目 ID / 批次 ID / 任务 ID
- 耗时、结果状态和错误码
- AI Provider 请求 ID 和用量摘要

### 13.2 指标

- 每日小程序访问量
- 电话/微信联系按钮点击量
- 新建项目数
- 每个项目平均安装位置数
- 生成任务成功率
- 单张平均生成时长
- 自动重试率
- 工程师审核通过率
- 每个项目平均生成成本
- 分享链接打开次数

### 13.3 费用控制

- 只有工程师可以创建 AI 任务。
- 每个批次限制角度数量和每角度候选图数量。
- 创建前显示预计生成张数。
- 同一输入短时间重复提交时进行幂等拦截。
- 失败重试有上限。
- 定期清理未登记上传、过期临时文件和废弃生成结果。

## 14. 实施阶段

### 阶段 0：平台和 AI 可行性验证

交付：

- 注册/确认微信小程序 AppID。
- 创建 `dev` CloudBase 环境并完成 AppID 关联。
- 验证 `wx.cloud.init`、OPENID、数据库和存储链路。
- 使用 3 个真实项目样本完成 AI Provider 对比。
- 确定生产模型、单图成本和生成时长。

退出条件：至少一种方案能在工程师审核后产出可用于客户沟通的效果图。

### 阶段 1：工程骨架与公共展示

交付：

- 原生 TypeScript 小程序骨架。
- 开发/生产环境配置。
- 首页、业务、案例和联系页面。
- 公共内容集合、规则和云存储路径。
- 公共组件与视觉样式。

退出条件：普通顾客可完整浏览内容并联系店铺。

### 阶段 2：工程师项目工作台

交付：

- 工程师白名单与服务端鉴权。
- 项目、安装位置和产品组合管理。
- 现场照片、结构简图和材质参考上传。
- 结构化材料、颜色和客户要求录入。
- 草稿保存与资料完整性检查。

退出条件：工程师可以完整录入一个包含多个安装位置的项目。

### 阶段 3：AI 生成与审核

交付：

- Provider 适配层。
- 多角度批次和任务队列。
- AI Worker、异步同步和结果转存。
- 生成进度、失败重试和成本记录。
- 工程师审核清单与确认流程。

退出条件：从真实项目资料到审核通过效果图的流程可重复完成。

### 阶段 4：专属分享与上线准备

交付：

- 分享版本、有效期和停用能力。
- 客户专属预览页面。
- 多角度切换、AI 标识和免责声明。
- 安全规则、隐私、日志与异常检查。
- 生产环境部署与小程序提审资料。

退出条件：未审核内容无法分享，过期或停用链接无法访问，客户只能看到授权项目。

### 阶段 5：试运行

交付：

- 使用 3–5 个真实项目试运行。
- 记录生成成功率、审核通过率、生成时长和成本。
- 优化录入表单、角度模板和提示词。
- 修复首轮工程师与客户反馈。

## 15. 粗略工作量

以下估算以 1 名熟悉小程序和云开发的全栈开发者为前提，不包含大量内容拍摄和 AI 模型训练：

| 阶段 | 预估 |
| --- | --- |
| 平台与 AI 验证 | 3–5 个工作日 |
| 公共展示 | 5–7 个工作日 |
| 工程师工作台 | 7–10 个工作日 |
| AI 生成与审核 | 7–12 个工作日 |
| 分享、安全与上线 | 5–7 个工作日 |
| 试运行优化 | 5–10 个工作日 |

首版开发与试运行合计约 6–9 周。AI 模型效果是最大不确定项，因此阶段 0 必须在全面开发前完成。

## 16. 开发启动前检查清单

### 微信与平台

- [ ] 已有可使用的微信小程序账号和 AppID
- [ ] 已完成必要的主体认证
- [ ] 已开通微信云开发
- [ ] 已创建开发和生产环境
- [ ] AppID 已关联对应 CloudBase 环境
- [ ] 已确认 CloudBase 套餐和 AI 资源额度

### 店铺内容

- [ ] 店铺电话、微信号、二维码、地址和营业时间
- [ ] 业务分类与简短介绍
- [ ] 至少 6 个可公开成功案例
- [ ] 案例图片已获得展示许可
- [ ] 材料、材质、颜色和产品组合常用选项

### AI 样本

- [ ] 3 个真实项目的现场多角度照片
- [ ] 对应结构简图
- [ ] 材质和颜色参考
- [ ] 工程师认可的预期效果样例
- [ ] 不允许 AI 改动的结构要点

## 17. 当前待确认事项

1. 是否已经注册微信小程序账号并获得 AppID。
2. 工程师首版预计有多少人，需要“所有工程师互相可见项目”还是“仅项目负责人可见”。
3. 是否能提供 3 个真实历史项目作为 AI 可行性验证样本。
4. 成功案例内容由谁负责录入和维护。
5. 分享链接默认有效期使用 30 天还是长期有效、手动停用。

## 18. 官方参考

- [微信小程序调用 CloudBase 云函数](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)
- [CloudBase 云函数](https://docs.cloudbase.net/cloud-function/develop)
- [CloudBase 云函数运行环境](https://docs.cloudbase.net/cloud-function/runtime-support)
- [CloudBase 数据库安全规则](https://docs.cloudbase.net/database/security-rules)
- [CloudBase 云存储安全规则](https://docs.cloudbase.net/storage/security-rules)
- [CloudBase AI wx-server-sdk 生图](https://docs.cloudbase.net/ai/image-model/wx-server-sdk)
- [腾讯云 MPS AI 图片生成](https://cloud.tencent.com/document/product/862/132095)
- [腾讯混元线稿生图](https://cloud.tencent.com/document/product/1668/110863)

