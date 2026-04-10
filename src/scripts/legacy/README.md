# Legacy Scripts Placeholder

当前目录用于后续脚本下线归档占位。

## 触发条件

- 脚本不再被页面/组件直接 import。
- 脚本不再被 `src/scripts/layout/index.ts` 动态 import。
- 已通过回归验证确认无运行时行为依赖。

## 使用约束

- 未通过上述判定前，不得将运行中脚本迁入 `legacy`。
- 迁入 `legacy` 的脚本应同步更新 `ARCHIVE_MANIFEST.md`。
