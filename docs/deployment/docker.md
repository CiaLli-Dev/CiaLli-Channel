# Docker 部署

## 架构

生产部署默认使用单机 `docker compose`，服务拓扑如下：

- `proxy`：统一处理站点入口与 HTTPS 终止
- `web`：Astro Node 服务
- `worker`：AI Summary Worker
- `directus`：CMS 与 API
- `postgres`：Directus 主数据库
- `redis`：缓存、限流与分布式刷新协调
- `minio`：对象存储

当前运行时仅保留对象存储：

- `s3`：新上传与历史迁移后的文件统一走 MinIO
- 历史 local 文件已迁移完成，运行时不再挂载 local uploads 目录

Directus 后台默认只绑定到 `127.0.0.1:8055`，不直接暴露公网。

## 准备环境变量

1. 根目录 [`.env.example`](/Users/uednd/code/CiaLli-Channel/.env.example) 是唯一环境变量模板，复制为 `.env` 后统一维护。
2. 同一份 `.env` 同时服务于：
   本机脚本 / 开发调试
   Docker Compose
3. 容器内互联地址、PostgreSQL/MinIO 默认账号、对象存储 bucket、Directus `s3` 存储参数与 AI worker 端口都已固定在仓库配置中，不再通过 `.env` 覆写。
4. 当前建议显式配置的环境变量为：
   `APP_PUBLIC_BASE_URL`
   `DIRECTUS_URL`
   `DIRECTUS_STATIC_TOKEN`
   `BANGUMI_TOKEN_ENCRYPTION_KEY`
   `AI_SUMMARY_INTERNAL_SECRET`
   `DIRECTUS_SECRET`
   `DIRECTUS_ADMIN_EMAIL`
   `DIRECTUS_ADMIN_PASSWORD`
   `POSTGRES_PASSWORD`
   `MINIO_ROOT_PASSWORD`
   `STORAGE_S3_KEY`
   `STORAGE_S3_SECRET`
5. `PUBLIC_ASSET_BASE_URL` 是唯一保留的可选环境变量；留空时继续统一走站内 BFF 代理资源地址。

建议在启动前先执行：

```bash
git lfs install
git lfs pull
pnpm check:env
```

本地环境默认会放宽对占位值的检查；如需在 CI 或正式发版前强制按生产标准校验，可使用：

```bash
CHECK_ENV_STRICT=1 pnpm check:env
```

## 本地热更新启动

```bash
pnpm docker:build
pnpm docker:up
```

仓库提供 [docker-compose.override.yml](/Users/uednd/code/CiaLli-Channel/docker-compose.override.yml) 作为本地开发覆盖配置。使用默认 `docker compose up` 时，`web` 会以 `pnpm dev` 运行并挂载源码，`worker` 会以 `tsx watch` 运行，代码改动会自动热更新或重启。

## 生产启动

生产环境需要显式绕过本地 override，只加载主 [docker-compose.yml](/Users/uednd/code/CiaLli-Channel/docker-compose.yml)：

```bash
pnpm docker:build
pnpm docker:up:prod
```

等价的原生命令是：

```bash
docker compose -f docker-compose.yml up -d
```

首次启动会自动完成：

- PostgreSQL 初始化
- Redis 启动
- MinIO bucket 创建
- 演示 seed 恢复（仅空卷首次启动）
- Directus 数据库迁移与管理员初始化（仅 seed 未恢复时触发）

## 演示种子与后台账号

仓库内置的演示种子覆盖：

- PostgreSQL 业务与 Directus 系统表
- MinIO bucket 中的对象资源

恢复只会在以下条件同时成立时触发：

- `postgres_data` 是空库或尚未完成业务初始化
- `minio_data` 中的目标 bucket 为空

若 volume 已有数据，恢复脚本会自动跳过，不会覆盖现有环境。

演示种子恢复后，Directus 后台默认管理员账号为：

- 邮箱：`demo-admin@example.com`
- 密码：`CiaLli-demo-admin-2026!`

请注意：

- 该账号来自种子数据库，而不是 `.env` 中空库 bootstrap 的初始化逻辑
- AI 运行时密钥与内部调用密钥仍必须通过 `.env` 提供，seed 不携带这些值
- 如果需要重新触发演示恢复，请先删除 `postgres_data` 与 `minio_data` 对应的 Docker volume

## 访问

- 主站通过 `proxy` 对外暴露 `80/443`
- Directus 后台仅绑定 `127.0.0.1:8055`
- MinIO Console 仅绑定 `127.0.0.1:9001`

如需访问 Directus 后台，建议使用 SSH 隧道或在服务器本机浏览器访问。

## 升级顺序

1. 使用统一 Docker 数据包备份 PostgreSQL、Directus schema 与 MinIO 数据
2. 应用 Directus schema 变更
3. 重建镜像并滚动 `web` / `worker`
4. 回归验证主站、资源代理、AI worker 与后台健康状态

## Docker 数据包备份与恢复

当前 Docker Compose 环境的数据备份使用统一 zip 包，不再分开手动处理 PostgreSQL 与 MinIO。

导出当前环境：

```bash
pnpm docker:data:export
```

也可以指定输出路径：

```bash
pnpm docker:data:export --output backups/docker-data-20260422-153000.zip
```

zip 包固定包含：

- `manifest.json`：格式版本、生成时间、源信息与强校验摘要
- `postgres/directus.dump`：完整 PostgreSQL 自定义格式 dump
- `directus/schema.json`：当前 Directus schema 快照
- `minio/objects/**`：当前固定 bucket `cialli-assets` 中的全部对象
- `minio/objects-manifest.json`：每个对象的 key、大小与 SHA-256

导入前可只做离线校验，不触碰当前 Docker 环境：

```bash
pnpm docker:data:verify backups/docker-data-20260422-153000.zip
```

导入 zip 包会先自动导出当前环境作为备份，然后停止 `web`、`worker`、`directus`，覆盖恢复 PostgreSQL 与 MinIO，最后重启服务并做轻量校验：

```bash
pnpm docker:data:import backups/docker-data-20260422-153000.zip
```

如需固定导入前备份路径：

```bash
pnpm docker:data:import backups/docker-data-20260422-153000.zip --backup-output backups/before-import-20260422-153500.zip
```

如果当前环境已有外部备份，或该环境可直接丢弃，可跳过导入前自动备份并直接覆盖：

```bash
pnpm docker:data:import backups/docker-data-20260422-153000.zip --no-backup
```

`--no-backup` 只跳过当前环境备份，仍会先校验 zip 包内的 manifest、PostgreSQL dump、Directus schema 与每个 MinIO 对象 SHA-256。

导入采用覆盖策略：

- PostgreSQL 会先重建 `public` schema，再恢复 zip 内 dump
- MinIO 会先清空目标 bucket，再恢复 zip 内对象
- 导入前备份默认写入 `backups/before-docker-data-import-<timestamp>.zip`
- `--no-backup` 会直接覆盖当前数据，不会生成导入前备份，无法由脚本提供回滚包
- 如果覆盖过程中失败，脚本会输出导入前备份路径；确认原因后可用该备份 zip 手动回滚

## 校验仓库种子

仓库内置演示 seed 可用以下命令校验：

```bash
pnpm seed:verify
```

`pnpm seed:verify` 会检查：

- `seed/postgres/demo.dump` 存在且不是 Git LFS pointer
- `seed/minio/demo-bucket/**` 中的对象不是 Git LFS pointer
- `seed/metadata.json` 中记录的 dump 大小与对象数量与实际文件一致
- `directus/schema/app-schema.json` 是有效的 Directus schema 快照
