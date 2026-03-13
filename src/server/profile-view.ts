import type { AppProfile, AppProfileView, AppUser } from "@/types/app";

export type ProfileUserView = Pick<
    AppUser,
    "id" | "email" | "first_name" | "last_name" | "description" | "avatar"
>;

export type AppProfileWithUser = AppProfile & {
    user?: Partial<ProfileUserView> | null;
};

export function toAppProfileView(
    profile: AppProfile,
    user?: Partial<ProfileUserView> | null,
): AppProfileView {
    return {
        ...profile,
        bio: normalizeProfileBio(user?.description),
        avatar_file: normalizeAvatarFileId(user?.avatar),
    };
}

export function normalizeProfileBio(value: unknown): string | null {
    const text = String(value ?? "").trim();
    return text || null;
}

export function normalizeAvatarFileId(value: unknown): string | null {
    const fileId = String(value ?? "").trim();
    return fileId || null;
}
