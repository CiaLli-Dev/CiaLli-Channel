export type BangumiCollectionStatus =
    | "planned"
    | "completed"
    | "watching"
    | "onhold"
    | "dropped";

export type BangumiCollectionItem = {
    id: string;
    subject_id: number;
    title: string;
    title_cn: string | null;
    watch_status: BangumiCollectionStatus;
    rating: number | null;
    progress: number | null;
    total_episodes: number | null;
    year: string | null;
    studio: string | null;
    genres: string[];
    description: string | null;
    link: string;
    cover_url: string | null;
    private: boolean;
    updated_at: string | null;
};

export type BangumiListResult = {
    items: BangumiCollectionItem[];
    page: number;
    limit: number;
    total: number;
};

export type BangumiListQuery = {
    username: string;
    page: number;
    limit: number;
    status?: BangumiCollectionStatus;
    includePrivate: boolean;
    accessToken?: string | null;
};

type BangumiImageSet = {
    small?: string;
    grid?: string;
    large?: string;
    medium?: string;
    common?: string;
};

type BangumiTag = {
    name?: string;
};

export type BangumiSubject = {
    id?: number;
    name?: string;
    name_cn?: string;
    short_summary?: string;
    date?: string;
    eps?: number;
    score?: number;
    images?: BangumiImageSet;
    tags?: BangumiTag[];
};

export type BangumiCollectionRecord = {
    subject_id?: number;
    ep_status?: number;
    type?: number;
    rate?: number;
    private?: boolean;
    updated_at?: string;
    tags?: string[];
    subject?: BangumiSubject;
};

export type BangumiCollectionsResponse = {
    data?: BangumiCollectionRecord[];
    total?: number;
    limit?: number;
    offset?: number;
};
