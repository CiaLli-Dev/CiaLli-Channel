# CiaLli

<img align='right' src='public/assets/home/default-logo.png' width='180px' alt="CiaLli logo">

CiaLli 是一个现代化的轻量内容社区，基于 [Mizuki](https://github.com/matsuzaka-yuki/Mizuki) 模板开发。使用 [Directus](https://directus.io/) 作为无头 CMS 后端，负责数据存储、用户管理和文件托管。

> [!NOTE]
> 本项目大部分代码、测试和文档均由智能体编写。维护者仅对体感功能进行简单测试，对数据安全与代码质量不作任何保障，但我们会尽最大努力修复问题。
>
> **CiaLli 现有架构不适用于并发数量较大的场景，这会导致整个系统出现严重故障。**

## 🤔 项目有哪些功能？

### 文章与日记

- 发布正式的**图文文章**，也可以随时写几句简短的**日记**，记录当下的所思所想。
- 可选保存草稿，写到一半不用担心内容丢失。

【* 草稿目前仅支持文章内容】

### 评论与互动

每篇文章和日记下方都有**评论区**，欢迎大家留下你的想法，和作者、其他读者一起聊聊。

### 相册

创建属于自己的相册，记录生活中的美好瞬间。

### Bangumi 收藏墙

支持绑定个人 Bangumi ID。绑定后社区个人主页可选展示 Bangumi 的收藏内容。

### 完善的权限体系

项目内置了**普通成员**、**站点管理员**及**超级管理员**这三个角色。

- 站点管理员：管理站点相关设置，例如公告、壁纸等，也可以删除普通成员发布的内容、审批注册申请等。
- 超级管理员：管理 Directus 后端，通常作维护用。

#### 隐私设置

文章、日记、相册、个人主页等内容均可选是否公开。

### 富文本支持

大部分页面均支持 Markdown 及其增强语法，你可以随心为自己撰写的文章甚至评论添加各类丰富的格式，读者也能阅览到排版更精美的页面。

【* 日记内容设计为仅支持普通文本】

### RSS / Atom 订阅

如果你使用 RSS 阅读器，可以订阅我们的内容推送，第一时间获取最新文章，不错过任何更新。

注意：该功能尚未测试。

## 🤔 如何使用？

进入站点后，你可以直接浏览公开内容，无需登录。如果你希望发布内容、管理个人主页或参与评论互动，可以申请注册账号。

## ❤️ 写在最后

这个网站从无到有，离不开以下作者对本项目做出的贡献

[![项目贡献者](https://contrib.rocks/image?repo=CiaLliChannel-Dev/CiaLli)](https://github.com/CiaLliChannel-Dev/CiaLli/graphs/contributors)

**同时，也非常感谢 [Mizuki](https://github.com/matsuzaka-yuki/Mizuki) 及其上游作者提供了开箱即用的模板与设计资源。**

项目目前还在持续完善中，未来还会有更多新功能陆续上线。

## 加入开发团队？

### 项目 Wiki

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/CiaLliChannel-Dev/CiaLli)

### 贡献指南

见 [CONTRIBUTING.md](CONTRIBUTING.md)

## 开源许可证

本项目基于 Apache 许可证 2.0 - 查看 [LICENSE](LICENSE) 文件了解详情。

### 原始项目许可证

Mizuki 基于 [Fuwari](https://github.com/saicaca/fuwari) 开发，该项目使用 MIT 许可证。根据 MIT 许可证要求，原始版权声明和许可声明已包含在 [LICENSE.MIT](LICENSE.MIT) 中。

---

![Star History](https://api.star-history.com/svg?repos=CiaLli-Dev/CiaLli-Channel&type=Date)

> ⭐ 如果这个项目对您有帮助，请考虑给它一个星标！或者将它分享给更多人！
