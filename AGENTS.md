# FOR AGENTS

## 目标与技术栈

- 项目简介：基于 Mizuki 和 Directus SDK 开发的内容社区
- 包管理器：仅使用 `pnpm`
- 构建输出：Astro `output: "static"`

## 最高优先级规则

- 探索模式下，可按需查阅项目 Wiki 文档（CiaLli.wiki/Home.md）避免全量探索和盲目探索
- 实现功能前先检索现有模块，避免重复实现
- 关键代码需要写注释（中文）
- 后端数据访问优先走 Directus SDK 与现有封装，不要在 API Handler 中散落直连逻辑
- 删除字段/链路时按用户要求直接收敛，不额外保留兼容层
- 禁止引入 `any`、`as any`、隐式 `any` 与类型抑制注释

## 项目关键链路

- 页面入口：`src/pages/**`
- BFF 入口：`src/pages/api/v1/[...segments].ts` → `src/server/api/v1.ts`
- 路由聚合：`src/server/api/v1/router.ts`
- 路由分域：
  - 公开：`src/server/api/v1/public/**`
  - 用户：`src/server/api/v1/me/**`
  - 管理：`src/server/api/v1/admin/**`
  - 共享：`src/server/api/v1/shared/**`
  - 独立模块：`public-data.ts`、`comments.ts`、`uploads.ts`
- 参数校验：`src/server/api/schemas/**` + `src/server/api/validate.ts`（Zod）
- 领域层：`src/server/domain/**`（Rules → Repository → Service）
- Directus 客户端：`src/server/directus/client.ts`
- 认证与会话：`src/server/directus-auth.ts`、`src/server/auth/session.ts`
- ACL：`src/server/auth/acl.ts`

## Directus 数据模型约定

- 业务集合前缀统一 `app_*`（定义见 `src/server/directus/schema.ts`）
- 系统集合：`directus_users`、`directus_files`
- 业务集合标准字段：`status`、`sort`、`user_created`、`date_created`、`user_updated`、`date_updated`

当前业务集合（摘要）：

- 用户：`app_user_profiles`、`app_user_permissions`、`app_user_blocks`、`app_user_registration_requests`
- 内容：`app_articles`、`app_article_comments`、`app_article_likes`、`app_article_comment_likes`
- 日记：`app_diaries`、`app_diary_images`、`app_diary_comments`、`app_diary_likes`、`app_diary_comment_likes`
- 其他：`app_anime_entries`、`app_albums`、`app_album_photos`、`app_friends`、`app_site_settings`

## 安全与渲染约束

- Markdown 渲染结果必须经过 `sanitizeMarkdownHtml()`（`src/server/markdown/sanitize.ts`）
- 禁止在 Markdown 渲染链路注入内联 `<script>`
- 前端不可直连 Directus 资源，统一使用代理路径 `/api/v1/public/assets/:id`
- 构建资源 URL 使用 `buildDirectusAssetUrl()`（`src/server/directus-auth.ts`）

## 数据与前端约定

- `tags/genres` 为 JSON 数组字段，读取时统一归一化为 `string[]`
  - API 侧：`safeCsv`（`src/server/api/v1/shared/helpers.ts`）
  - 页面侧：`normalizeTags`（`src/utils/content-utils.ts`）
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
pnpm check && pnpm lint && pnpm build && pnpm format
```

如涉及领域逻辑或接口行为，补充执行：

```bash
pnpm test
```
