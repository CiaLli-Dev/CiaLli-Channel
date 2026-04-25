export type SearchIndexEntity =
    | "article"
    | "diary"
    | "album"
    | "comment"
    | "user";

export const searchIndex = {
    async remove(_entity: SearchIndexEntity, _id: string): Promise<void> {
        // 当前仓库没有独立搜索索引实现；这里固定删除 use case 的调用点。
    },
};
