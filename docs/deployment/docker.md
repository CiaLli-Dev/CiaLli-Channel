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

1. 首次安装默认使用全局安装器 `cialli-install install` 自动生成根目录 `.env`，并在命令行中完成管理员引导账户创建。
2. 手动维护 `.env` 仅用于已有环境恢复、排障或高级部署；模板文件仍以 [`.env.example`](/Users/uednd/code/CiaLli-Channel/.env.example) 为准。
3. 同一份 `.env` 同时服务于：
   本机脚本 / 开发调试
   Docker Compose
4. 容器内互联地址、PostgreSQL/MinIO 默认账号、对象存储 bucket、Directus `s3` 存储参数与 AI worker 端口都已固定在仓库配置中，不再通过 `.env` 覆写。
5. 当前运行时要求的环境变量为：
   `APP_PUBLIC_BASE_URL`
   `DIRECTUS_URL`
   `DIRECTUS_STATIC_TOKEN`
   `BANGUMI_TOKEN_ENCRYPTION_KEY`
   `AI_SUMMARY_INTERNAL_SECRET`
   `DIRECTUS_SECRET`
   `POSTGRES_USER`
   `POSTGRES_DB`
   `POSTGRES_PASSWORD`
   `MINIO_ROOT_USER`
   `MINIO_ROOT_PASSWORD`
   `STORAGE_S3_KEY`
   `STORAGE_S3_SECRET`
6. 安装器还会把 `DIRECTUS_ADMIN_EMAIL` 与 `DIRECTUS_ADMIN_PASSWORD` 一并写入 `.env`，用于首次安装后的后台登录与运维排障；运行时服务本身不依赖这两项。
7. `PUBLIC_ASSET_BASE_URL` 是唯一保留的可选环境变量；留空时继续统一走站内 BFF 代理资源地址。
8. `pnpm check:env` 只负责校验已存在的 `.env`；首次安装所需密钥、账号名与静态 token 都由安装器生成并写入。
9. `APP_PUBLIC_BASE_URL` 是站点唯一公网入口真源，同时驱动 Astro `site`、sitemap、RSS、canonical 与 Caddy 反向代理入口；它必须是站点根 URL，不支持子路径部署。

## 全局安装器

首次部署推荐使用全局安装器：

```bash
pnpm install -g . && cialli-install install --site-url https://example.com
```

安装器会自动完成：

- 宿主机环境检查（Docker / Compose / 端口 / Git LFS / 支持的平台）
- 先让用户选择安装器语言（当前支持 `en`、`zh_CN`、`zh_TW`、`ja`）
- 仅要求用户输入站点公开 URL，其余账号、密码、token、secret 自动生成并写入 `.env`
- 构建 `web` / `worker`
- 启动基础设施与 Directus
- 使用生成的管理员账户完成 Directus 初始化
- 自动生成并回填 `DIRECTUS_STATIC_TOKEN`
- 将所选语言写入站点默认语言设置
- 启动 `web`、`worker`、`proxy`
- 在 CLI 中按分组展示所有生成值，并提示可随时在 `.env` 查看

非交互部署可显式提供参数：

```bash
cialli-install install \
  --lang zh_CN \
  --site-url https://example.com
```

如果当前目录已有 `.env`、Compose volumes 或历史容器记录，安装器默认拒绝覆盖；显式传入 `--reset` 才会清空当前 Compose 资源并重装。

建议在启动前先执行：

```bash
git lfs install
git lfs pull
```

已有 `.env` 的环境可继续手动运行校验；本地环境默认会放宽对占位值的检查。如需在 CI 或正式发版前强制按生产标准校验，可使用：

```bash
CHECK_ENV_STRICT=1 pnpm check:env
```

## 本地热更新启动

```bash
pnpm docker:build
pnpm docker:up
```

仓库提供 [docker-compose.override.yml](/Users/uednd/code/CiaLli-Channel/docker-compose.override.yml) 作为本地开发覆盖配置。使用默认 `docker compose up` 时，`web` 会以 `pnpm dev` 运行并挂载源码，`worker` 会以 `tsx watch` 运行，代码改动会自动热更新或重启。该入口仅用于本地开发，不作为正式生产部署流程。

## 生产部署约定

正式部署流程统一使用安装器。安装器内部仍基于主 [docker-compose.yml](/Users/uednd/code/CiaLli-Channel/docker-compose.yml) 启动生产服务，并自动绕过本地开发用 override 配置。

## 演示种子与后台账号

仓库内置的演示种子覆盖：

- PostgreSQL 业务与 Directus 系统表
- MinIO bucket 中的对象资源

当前仓库的 MinIO demo seed 允许为空：

- 当 `seed/metadata.json` 中 `minio.objectCount=0` 时，`seed/minio/demo-bucket` 缺失会被视为“空 seed”
- 若未来 `minio.objectCount > 0`，则该目录仍必须存在并包含对应对象

恢复只会在以下条件同时成立时触发：

- `postgres_data` 是空库或尚未完成业务初始化
- `minio_data` 中的目标 bucket 为空

若 volume 已有数据，恢复脚本会自动跳过，不会覆盖现有环境。

请注意：

- 当前仓库内的 seed 已是干净产物：不包含可直接登录的固定管理员账户，也不包含可复用的静态 token 或会话
- 当前 `seed/metadata.json` 记录的 MinIO `objectCount` 为 `0`，因此首次部署只会创建 bucket，不会恢复任何演示对象
- 管理员账户由安装器在 restore 后自动生成并写入 `.env`，而不是来自 seed
- AI 运行时密钥、基础设施账号名与内部调用密钥都由安装器写入 `.env`
- PostgreSQL seed dump 仍通过 Git LFS 分发，部署前依然应执行 `git lfs install && git lfs pull`
- 如果需要重新触发演示恢复，请先删除 `postgres_data` 与 `minio_data` 对应的 Docker volume，或使用 `cialli-install install --reset`

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
- `seed/minio/demo-bucket/**` 中的对象不是 Git LFS pointer；当 `minio.objectCount=0` 时允许该目录缺失并按空 seed 校验
- `seed/metadata.json` 中记录的 dump 大小与对象数量与实际文件一致
- `directus/schema/app-schema.json` 是有效的 Directus schema 快照
- 临时还原 `seed/postgres/demo.dump` 后，不存在 `demo-admin@example.com`
- 临时还原的 `directus_users.token` 全部为空
- 临时还原的 `directus_sessions` 为空

当前仓库中的 seed 已基于本地 Docker Compose 演示环境重建为干净产物，并明确不再依赖 restore 后的运行时净化步骤。
