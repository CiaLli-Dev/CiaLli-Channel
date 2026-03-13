# Contributing

## 开发流程

1. Fork 仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 开发并测试
4. 提交更改
5. 推送分支：`git push origin feature/your-feature`
6. 创建 Pull Request 到 `dev` 分支

## 环境准备

参见 [Getting Started](CiaLli.wiki/Getting-Started.md)。

## 代码校验

所有代码改动必须通过以下校验：

```bash
pnpm check && pnpm lint && pnpm build && pnpm format
```

| 命令 | 说明 |
|------|------|
| `pnpm check` | Astro 类型检查 |
| `pnpm lint` | ESLint 代码检查 |
| `pnpm build` | 完整构建（确保无编译错误） |
| `pnpm format` | Prettier 格式化 |

CI 流水线会在 PR 上自动运行这些检查。

## 代码规范

### TypeScript

- **strict 模式**：避免对 `undefined` 做隐式假设
- **显式返回类型**：导出函数与公共工具优先显式标注返回类型
- **禁止 `any`**：不允许新增 `any`、隐式 `any`、`as any`、类型错误抑制注释
- **类型导入**：使用 `import type` 语法

### 导入规范

```typescript
// 类型导入
import type { AppArticle } from "@/types/app";

// 外部依赖
import { readItems } from "@directus/sdk";

// 内部模块（使用路径别名）
import { getDirectusClient } from "@server/directus/client";
import { safeCsv } from "@server/api/v1/shared";
```

排列顺序：

1. 类型导入
2. 外部依赖
3. 内部模块（中间空行分组）

路径别名优先：`@components/*`、`@utils/*`、`@server/*`、`@/*`

### 注释

- 所有注释均使用**中文**编写
- 仅在逻辑不自明处添加注释

### Astro / Svelte

- Astro 组件在 frontmatter 中管理导入与 props
- 条件类优先使用 `class:list`
- 需要客户端交互时使用 `client:only="svelte"`
- `.astro` 内联脚本保证 DOM 安全访问

### Markdown 渲染

- 统一使用 `renderMarkdown()` 入口（`src/server/markdown/render.ts`）
- 不得自行创建新的 `unified()` 渲染链路
- 新增标签/属性需更新 `sanitize.ts` 白名单
- 详见 [Markdown Guidance](CiaLli.wiki/Markdown-Guidance.md)

## 安全规范

- Markdown 输出必须经过 `sanitizeMarkdownHtml()` 净化
- 禁止在 Markdown 渲染链路引入内联 `<script>`
- 外部请求与异步流程必须 `try/catch`
- 日志包含上下文：`console.error("[module] message", error)`
- 禁止静默吞错

## 环境变量安全

- 不提交 `.env` 文件（已在 `.gitignore` 中）
- 新增必需变量需更新 `src/server/env/required.ts`
- 新增可选变量需更新 `.env.example`

## 集合与数据规范

- 新集合使用 `app_` 前缀
- 所有业务集合包含标准字段：`status/sort/user_created/date_created/user_updated/date_updated`
- `tags/genres` 字段读取使用 `safeCsv()` / `normalizeTags()`，不直接假设类型

## 脚本规范

- 新脚本放在 `scripts/` 并注册到 `package.json`
- 一次性迁移脚本完成后应删除，避免仓库残留

## 包管理器

项目仅使用 **pnpm**。`preinstall` 钩子会拒绝 npm/yarn。

## 分支策略

- `master`：生产分支
- `dev`：开发分支
- 功能分支从 `dev` 创建，PR 合并到 `master`

## 相关文档

- [架构概述](CiaLli.wiki/Architecture-Overview.md) - 系统架构
- [数据模型](CiaLli.wiki/Data-Model.md) - 数据模型
- [API 参考](CiaLli.wiki/API-Reference.md) - API 参考
- [Markdown Guidance](CiaLli.wiki/Markdown-Guidance.md) - Markdown 管线指导
- [Layout State Machine](CiaLli.wiki/Layout-State-Machine.md) - 布局状态机
