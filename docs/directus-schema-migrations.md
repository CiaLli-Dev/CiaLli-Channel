# Directus Schema 迁移约定

## 目标

仓库内不再把 MCP 手工改库作为唯一发布手段。Directus 数据模型变更统一进入版本控制，并跟随 Docker 部署一起发布。

当前仓库同时维护两类交付物：

- 演示 seed：用于新环境首次启动时恢复演示数据与对象资源
- schema snapshot：用于结构演进、审阅与正式环境发布

两者职责不同，不能互相替代。

当前仓库内的演示 seed 已经基于本地 Docker Compose 演示环境重建为干净产物。后续如果需要再次刷新 seed，应继续以运行中的演示 Docker 环境为源，但结构性变更仍应以 schema snapshot 为准。

## 约定

- 结构性变更以 `schema snapshot / apply` 为主
- 数据回填、复杂转换、一次性修复可额外编写自定义 migration 脚本
- 发布前先备份数据库，再执行 schema apply
- 生产环境的 schema 变更必须保留仓库内快照文件

当前快照默认存放路径：

- [directus/schema/app-schema.json](/Users/uednd/code/CiaLli-Channel/directus/schema/app-schema.json)

## 导出当前 Schema

```bash
pnpm directus:schema:snapshot
```

可通过环境变量自定义输出文件：

```bash
DIRECTUS_SCHEMA_FILE=./directus/schema/staging.json pnpm directus:schema:snapshot
```

## 应用 Schema

```bash
pnpm directus:schema:apply
```

可通过环境变量指定其他快照文件：

```bash
DIRECTUS_SCHEMA_FILE=./directus/schema/staging.json pnpm directus:schema:apply
```

## 发布建议

1. 导出并审阅最新 schema 快照
2. 提交 schema 快照与应用代码
3. 生产发布前备份数据库
4. 执行 `pnpm directus:schema:apply`
5. 执行 `docker compose up -d --build`
6. 验证主站、后台与 worker 行为
