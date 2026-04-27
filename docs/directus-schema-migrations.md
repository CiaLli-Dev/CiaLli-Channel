# Directus Schema 管理

## 目标

Directus 数据模型的结构变更必须进入版本控制，并与应用代码一起发布。仓库中的 schema 快照是当前结构定义的交付物，不能依赖线上手工操作作为唯一来源。

当前默认快照文件：

- [directus/schema/app-schema.json](/Users/uednd/code/CiaLli-Channel/directus/schema/app-schema.json)

## 基本原则

- 结构变更通过 schema 快照管理
- 代码与 schema 一起提交、一起评审、一起发布
- 发布前先备份现有环境
- 需要数据回填、数据修复或一次性清理时，单独编写脚本完成，不把业务数据变更混入 schema 快照

## 导出当前 Schema

确保 `directus` 容器已经运行，然后执行：

```bash
pnpm directus:schema:snapshot
```

默认会把当前容器内的 Directus schema 导出到：

- `directus/schema/app-schema.json`

如需导出到其他位置：

```bash
DIRECTUS_SCHEMA_FILE=./directus/schema/staging.json pnpm directus:schema:snapshot
```

## 应用 Schema

确保 `directus` 容器已经运行，并确认目标快照文件正确后执行：

```bash
pnpm directus:schema:apply
```

如需指定其他快照文件：

```bash
DIRECTUS_SCHEMA_FILE=./directus/schema/staging.json pnpm directus:schema:apply
```

脚本行为以 [scripts/directus/schema.sh](/Users/uednd/code/CiaLli-Channel/scripts/directus/schema.sh) 为准：

- `snapshot`：从运行中的 `directus` 容器导出 schema
- `apply`：把本地快照写入容器后执行 `npx directus schema apply`

## 日常流程

推荐工作流：

1. 在本地或测试环境完成 Directus 结构调整
2. 执行 `pnpm directus:schema:snapshot`
3. 审阅 `directus/schema/app-schema.json`
4. 将 schema 快照与对应应用代码一起提交
5. 发布前执行环境备份
6. 在目标环境执行 `pnpm directus:schema:apply`
7. 验证后台、API 与相关页面行为

## 发布建议

正式发布前建议按以下顺序执行：

```bash
pnpm docker:data:export
pnpm directus:schema:apply
pnpm docker:build
pnpm docker:up:prod
```

如果变更涉及：

- 新增集合、字段、关系或权限策略：重点检查后台可见性与 API 返回结构
- 文件链路：重点检查 `directus_files.storage` 仍为 `s3`
- 站点设置或权限模型：重点检查 `web`、`worker` 的静态 token 访问路径

## 注意事项

- `pnpm directus:schema:snapshot` 与 `pnpm directus:schema:apply` 都依赖运行中的 `directus` 容器
- 快照文件缺失时，`pnpm directus:schema:apply` 会直接失败
- Schema 快照只描述结构，不替代演示 seed、备份包或业务数据初始化
