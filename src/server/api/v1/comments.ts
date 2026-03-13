// 聚合文件：将文章评论和日记评论分别委托给独立模块处理。
// 保持原有导出接口不变，供 router.ts 及测试文件使用。

export {
    canCreateReplyAtDepth,
    parseCommentPagination,
} from "./comments-shared";

export { handleArticleComments } from "./comments-article";
export { handleDiaryComments } from "./comments-diary";
