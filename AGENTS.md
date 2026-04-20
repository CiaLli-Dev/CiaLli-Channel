# FOR AGENTS

## 目标与技术栈

- 项目简介：基于 Mizuki 和 Directus SDK 开发的内容社区
- 包管理器：仅使用 `pnpm`
- 构建输出：Astro `output: "server"`，默认按需渲染，静态路由需显式 `prerender = true`

## 最高优先级规则

- 实现功能前先检索现有模块，避免重复实现
- 复杂逻辑需编写中文注释
- 后端数据访问优先走 Directus SDK 与现有封装，不要在 API Handler 中散落直连逻辑
- 删除字段/链路时按用户要求直接收敛，不额外保留兼容层
- 禁止引入 `any`、`as any`、隐式 `any` 与类型抑制注释

## Directus MCP

- 若涉及数据库字段变更操作，必须使用 Directus MCP
- 同时使用环境中存在的 2 个 Directus MCP 服务器：一个操作生产端、另一个操作测试端
- 若工作环境中的 Directus MCP 服务器数量不等于 2，终止任何操作、告知用户并结束对话

## 项目关键链路

- 页面入口：`src/pages/**`
- BFF 主入口链路：`src/pages/api/v1/[...segments].ts` → `src/server/api/v1.ts` → `src/server/api/v1/router.ts`
- 路由分域：
  - 公开：`src/server/api/v1/public/**`
  - 用户：`src/server/api/v1/me/**`
  - 管理：`src/server/api/v1/admin/**`
  - 共享与基础模块：`src/server/api/v1/shared/**`、`comments.ts`、`uploads.ts`、`assets.ts`
- 参数校验：`src/server/api/schemas/**` + `src/server/api/validate.ts`（Zod）
- 应用层：`src/server/application/**`（编排用例与跨模块流程）
- 领域层：`src/server/domain/**`（领域规则与业务约束）
- 仓储层：`src/server/repositories/**`（数据访问抽象）
  - `src/server/repositories/directus/scope.ts` 是 Directus 访问上下文切换点（public/service/user）
- Directus 客户端：`src/server/directus/client.ts`
- 认证与会话：`src/server/directus-auth.ts`、`src/server/auth/session.ts`
- 访问控制：`src/server/auth/acl.ts`、`src/server/auth/directus-access.ts`

## Directus 数据模型约定

- 业务集合前缀统一 `app_*`（定义见 `src/server/directus/schema.ts`）
- 系统集合：`directus_users`、`directus_files`
- 业务集合标准字段：`status`、`sort`、`user_created`、`date_created`、`user_updated`、`date_updated`
- 业务集合清单以 `src/server/directus/schema.ts` 的 `DirectusSchema` 为唯一真源，不在 AGENTS 维护硬编码枚举
- 权限模型来自 Directus role/policies 映射（见 `src/server/auth/directus-access.ts`），不是 `app_user_permissions` 集合

## 安全与渲染约束

- Markdown 渲染结果必须经过 `sanitizeMarkdownHtml()`（`src/server/markdown/sanitize.ts`）
- 禁止在 Markdown 渲染链路注入内联 `<script>`
- 前端不可直连 Directus 资源，统一走 BFF 代理
  - 公开资源：`/api/v1/public/assets/:id`
  - 鉴权资源：`/api/v1/assets/:id`
- 资源 URL 构建策略：公开资源优先 `buildPublicAssetUrl()`；鉴权资源使用 `buildDirectusAssetUrl()`（`src/server/directus-auth.ts`）
- 写接口必须保留中枢守卫（`src/server/api/v1/router.ts`）：same-origin + CSRF + rate limit

## 数据与前端约定

- `tags/genres` 为 JSON 数组字段，读取时统一归一化为 `string[]`
  - API 侧：`safeCsv`（`src/server/api/v1/shared/helpers.ts`）
  - 页面侧：`normalizeTags`（`src/utils/content-post-helpers.ts`）
- 客户端跳转统一使用 `navigateToPage()`（`src/utils/navigation-utils.ts`）
- 登录态受保护链接使用 `data-auth-target-href` / `data-needs-login`

## TypeScript 与导入规范

- 现状为 `strictNullChecks: true`，编码时按严格空值处理
- 导出函数优先显式返回类型
- 类型导入使用 `import type`
- 导入顺序：外部在前，内部在后，分组空行
- 路径别名：`@components/*`、`@assets/*`、`@constants/*`、`@utils/*`、`@i18n/*`、`@layouts/*`、`@/*`
- 服务端模块使用 `@/server/*`（不存在 `@server/*`）

## 变更交付与质量门禁

代码改动后至少执行：

```bash
pnpm check && pnpm type-check:projects && pnpm lint && pnpm build && pnpm format
```

- `pnpm format` 会改写文件；格式化后需确保无新增 `lint/build` 回归

如涉及领域逻辑或接口行为，补充执行：

```bash
pnpm test
```
