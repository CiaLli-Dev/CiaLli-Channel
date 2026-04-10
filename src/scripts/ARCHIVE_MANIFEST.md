# Scripts Archive Manifest

## 入口判定规则

- 在用脚本判定口径：页面/组件直接 import + `src/scripts/layout/index.ts` 动态 import。
- 本次仅做结构整理与路径迁移，不做功能下线。

## 归档结论

- 按上述判定口径，当前无可安全下线脚本。
- `legacy` 目录本次仅占位，未迁入运行中脚本。

## 路径映射（旧 -> 新）

| 旧路径 | 新路径 |
| --- | --- |
| `src/scripts/admin-about-page-helpers.ts` | `src/scripts/admin/about-page-helpers.ts` |
| `src/scripts/admin-about-page.ts` | `src/scripts/admin/about-page.ts` |
| `src/scripts/admin-bulletin-page-helpers.ts` | `src/scripts/admin/bulletin-page-helpers.ts` |
| `src/scripts/admin-bulletin-page.ts` | `src/scripts/admin/bulletin-page.ts` |
| `src/scripts/admin-users-page-helpers.ts` | `src/scripts/admin/users-page-helpers.ts` |
| `src/scripts/admin-users-page.ts` | `src/scripts/admin/users-page.ts` |
| `src/scripts/album-editor-helpers.ts` | `src/scripts/albums/editor-helpers.ts` |
| `src/scripts/album-filter.ts` | `src/scripts/albums/filter.ts` |
| `src/scripts/album-new-page.ts` | `src/scripts/albums/new-page.ts` |
| `src/scripts/archive-filter-helpers.ts` | `src/scripts/archives/filter-helpers.ts` |
| `src/scripts/archive-filter.ts` | `src/scripts/archives/filter.ts` |
| `src/scripts/article-share-dialog.ts` | `src/scripts/interactions/article-share-dialog.ts` |
| `src/scripts/auth-state.ts` | `src/scripts/auth/state.ts` |
| `src/scripts/bangumi-filter.ts` | `src/scripts/bangumi/filter.ts` |
| `src/scripts/calendar-widget-helpers.ts` | `src/scripts/widgets/calendar/helpers.ts` |
| `src/scripts/calendar-widget.ts` | `src/scripts/widgets/calendar/index.ts` |
| `src/scripts/code-collapse.js` | `src/scripts/markdown/code-collapse.js` |
| `src/scripts/code-copy.ts` | `src/scripts/markdown/code-copy.ts` |
| `src/scripts/comments-api.ts` | `src/scripts/comments/api.ts` |
| `src/scripts/comments-controller-base.ts` | `src/scripts/comments/controller-base.ts` |
| `src/scripts/comments-controller-load.ts` | `src/scripts/comments/controller-load.ts` |
| `src/scripts/comments-controller.ts` | `src/scripts/comments/controller.ts` |
| `src/scripts/comments-helpers.ts` | `src/scripts/comments/helpers.ts` |
| `src/scripts/comments-init.ts` | `src/scripts/comments/init.ts` |
| `src/scripts/comments-render.ts` | `src/scripts/comments/render.ts` |
| `src/scripts/comments-types.ts` | `src/scripts/comments/types.ts` |
| `src/scripts/detail-action-float-helpers.ts` | `src/scripts/interactions/detail-action-float-helpers.ts` |
| `src/scripts/dialogs.ts` | `src/scripts/shared/dialogs.ts` |
| `src/scripts/diary-editor-helpers.ts` | `src/scripts/diary-editor/helpers.ts` |
| `src/scripts/diary-editor-page.ts` | `src/scripts/diary-editor/page.ts` |
| `src/scripts/diary-editor-render.ts` | `src/scripts/diary-editor/render.ts` |
| `src/scripts/diary-editor-save.ts` | `src/scripts/diary-editor/save.ts` |
| `src/scripts/dom-helpers.ts` | `src/scripts/shared/dom-helpers.ts` |
| `src/scripts/filter-shared.ts` | `src/scripts/shared/filter-shared.ts` |
| `src/scripts/floating-toc.ts` | `src/scripts/toc/floating-toc.ts` |
| `src/scripts/github-card-runtime.ts` | `src/scripts/markdown/github-card-runtime.ts` |
| `src/scripts/http-client.ts` | `src/scripts/shared/http-client.ts` |
| `src/scripts/i18n-runtime.ts` | `src/scripts/shared/i18n-runtime.ts` |
| `src/scripts/image-crop-modal.ts` | `src/scripts/shared/image-crop-modal.ts` |
| `src/scripts/login-page.ts` | `src/scripts/auth/login-page.ts` |
| `src/scripts/markdown-image-paste.ts` | `src/scripts/markdown/image-paste.ts` |
| `src/scripts/markdown-preview-client.ts` | `src/scripts/markdown/preview-client.ts` |
| `src/scripts/me-homepage-page-helpers.ts` | `src/scripts/me/homepage-page-helpers.ts` |
| `src/scripts/me-homepage-page-setup.ts` | `src/scripts/me/homepage-page-setup.ts` |
| `src/scripts/me-homepage-page.ts` | `src/scripts/me/homepage-page.ts` |
| `src/scripts/me-page-avatar-bind.ts` | `src/scripts/me/page-avatar-bind.ts` |
| `src/scripts/me-page-avatar.ts` | `src/scripts/me/page-avatar.ts` |
| `src/scripts/me-page-helpers.ts` | `src/scripts/me/page-helpers.ts` |
| `src/scripts/me-page-profile-dom-bind.ts` | `src/scripts/me/page-profile-dom-bind.ts` |
| `src/scripts/me-page-profile-dom.ts` | `src/scripts/me/page-profile-dom.ts` |
| `src/scripts/me-page-social.ts` | `src/scripts/me/page-social.ts` |
| `src/scripts/me-page-types.ts` | `src/scripts/me/page-types.ts` |
| `src/scripts/me-page.ts` | `src/scripts/me/page.ts` |
| `src/scripts/mermaid-interaction-helpers.ts` | `src/scripts/markdown/mermaid/interaction-helpers.ts` |
| `src/scripts/mermaid-interaction.ts` | `src/scripts/markdown/mermaid/interaction.ts` |
| `src/scripts/mermaid-runtime.ts` | `src/scripts/markdown/mermaid/runtime.ts` |
| `src/scripts/mobile-edge-drawer.ts` | `src/scripts/layout/mobile-edge-drawer.ts` |
| `src/scripts/mobile-float-stack.ts` | `src/scripts/layout/mobile-float-stack.ts` |
| `src/scripts/mobile-post-toc-drawer.ts` | `src/scripts/toc/mobile-post-toc-drawer.ts` |
| `src/scripts/music-player-helpers.ts` | `src/scripts/widgets/music-player/helpers.ts` |
| `src/scripts/overlay-dialog.ts` | `src/scripts/shared/overlay-dialog.ts` |
| `src/scripts/password-protection-helpers.ts` | `src/scripts/auth/protection-helpers.ts` |
| `src/scripts/password-protection-page.ts` | `src/scripts/auth/protection-page.ts` |
| `src/scripts/post-interactions-helpers.ts` | `src/scripts/interactions/post-interactions-helpers.ts` |
| `src/scripts/post-interactions.ts` | `src/scripts/interactions/post-interactions.ts` |
| `src/scripts/progress-overlay-manager.ts` | `src/scripts/shared/progress-overlay-manager.ts` |
| `src/scripts/publish-editor-adapter.ts` | `src/scripts/publish/editor-adapter.ts` |
| `src/scripts/publish-editor-markdown-diagnostics.ts` | `src/scripts/publish/editor-markdown-diagnostics.ts` |
| `src/scripts/publish-editor-monaco-styles.ts` | `src/scripts/publish/editor-monaco-styles.ts` |
| `src/scripts/publish-editor-monaco.ts` | `src/scripts/publish/editor-monaco.ts` |
| `src/scripts/publish-page-dom.ts` | `src/scripts/publish/page-dom.ts` |
| `src/scripts/publish-page-helpers.ts` | `src/scripts/publish/page-helpers.ts` |
| `src/scripts/publish-page-preview.ts` | `src/scripts/publish/page-preview.ts` |
| `src/scripts/publish-page-submit.ts` | `src/scripts/publish/page-submit.ts` |
| `src/scripts/publish-page-toolbar.ts` | `src/scripts/publish/page-toolbar.ts` |
| `src/scripts/publish-page-ui.ts` | `src/scripts/publish/page-ui.ts` |
| `src/scripts/publish-page.ts` | `src/scripts/publish/page.ts` |
| `src/scripts/register-avatar-crop.ts` | `src/scripts/auth/avatar-crop.ts` |
| `src/scripts/register-form-validators.ts` | `src/scripts/auth/form-validators.ts` |
| `src/scripts/register-page-helpers.ts` | `src/scripts/auth/page-helpers.ts` |
| `src/scripts/register-page.ts` | `src/scripts/auth/page.ts` |
| `src/scripts/responsive-sidebar-placement.ts` | `src/scripts/layout/responsive-sidebar-placement.ts` |
| `src/scripts/right-sidebar-layout.js` | `src/scripts/layout/right-sidebar-layout.js` |
| `src/scripts/running-days-runtime.ts` | `src/scripts/layout/running-days-runtime.ts` |
| `src/scripts/save-progress-overlay.ts` | `src/scripts/shared/save-progress-overlay.ts` |
| `src/scripts/site-settings-page-crop-actions.ts` | `src/scripts/site-settings/page-crop-actions.ts` |
| `src/scripts/site-settings-page-crop.ts` | `src/scripts/site-settings/page-crop.ts` |
| `src/scripts/site-settings-page-editor.ts` | `src/scripts/site-settings/page-editor.ts` |
| `src/scripts/site-settings-page-helpers.ts` | `src/scripts/site-settings/page-helpers.ts` |
| `src/scripts/site-settings-page-nav.ts` | `src/scripts/site-settings/page-nav.ts` |
| `src/scripts/site-settings-page-upload.ts` | `src/scripts/site-settings/page-upload.ts` |
| `src/scripts/site-settings-page.ts` | `src/scripts/site-settings/page.ts` |
| `src/scripts/theme-optimizer.js` | `src/scripts/layout/theme-optimizer.js` |
| `src/scripts/toc-element.ts` | `src/scripts/toc/element.ts` |
| `src/scripts/toc-helpers.ts` | `src/scripts/toc/helpers.ts` |
| `src/scripts/toc-runtime.ts` | `src/scripts/toc/runtime.ts` |
| `src/scripts/toc-scroll-helpers.ts` | `src/scripts/toc/scroll-helpers.ts` |
| `src/scripts/unsaved-changes-guard-helpers.ts` | `src/scripts/shared/unsaved-changes-guard-helpers.ts` |
| `src/scripts/unsaved-changes-guard.ts` | `src/scripts/shared/unsaved-changes-guard.ts` |

