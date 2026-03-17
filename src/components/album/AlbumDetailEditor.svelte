<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { showConfirmDialog, showNoticeDialog } from "@/scripts/dialogs";
  import {
    finishTask,
    startTask,
    updateTask,
    type ProgressTaskHandle,
  } from "@/scripts/progress-overlay-manager";
  import { navigateToPage } from "@/utils/navigation-utils";
  import { getCsrfToken } from "@/utils/csrf";
  import {
    UPLOAD_LIMITS,
    UPLOAD_LIMIT_LABELS,
  } from "@/constants/upload-limits";
  import {
    weightedCharLength,
    ALBUM_TITLE_MAX,
    ALBUM_PHOTO_MAX,
  } from "@/constants/text-limits";

  /* ------------------------------------------------------------------ */
  /* Props                                                              */
  /* ------------------------------------------------------------------ */
  export let albumId: string;
  export let albumShortId: string | null = null;
  export let username: string;
  export let isOwner = false;
  export let initialEditMode = false;

  export let album: {
    title: string;
    description: string | null;
    category: string | null;
    tags: string[];
    date: string | null;
    location: string | null;
    layout: "grid" | "masonry";
    columns: number;
    status: "private" | "published";
    is_public: boolean;
    cover_file: string | null;
    cover_url: string | null;
  };

  type AlbumStatus = "private" | "published";

  type PhotoItem = {
    id: string;
    file_id: string | null;
    image_url: string | null;
    title: string | null;
    description: string | null;
    tags: string[];
    location: string | null;
    sort: number | null;
  };

  export let photos: PhotoItem[];

  export let assetUrlPrefix = "/api/v1/public/assets";

  /* ------------------------------------------------------------------ */
  /* State                                                              */
  /* ------------------------------------------------------------------ */
  let editing = initialEditMode;
  let saving = false;
  let saveMsg = "";

  // Album metadata (mutable copies)
  let mTitle = album.title;
  let mDescription = album.description || "";
  let mCategory = album.category || "";
  let mTags = (album.tags || []).join(", ");
  let mDate = album.date || "";
  let mLocation = album.location || "";
  let mLayout: "grid" | "masonry" = album.layout || "grid";
  let mStatus: AlbumStatus = album.status as AlbumStatus;
  let mIsPublic = album.is_public;
  let displayTags: string[] = [];

  // Photos (saved)
  let mPhotos = [...photos];

  // Pending uploads (local only, until save)
  type PendingLocalPhoto = {
    id: string;
    file: File;
    previewUrl: string;
  };

  type PendingExternalPhoto = {
    id: string;
    url: string;
  };

  let pendingLocalPhotos: PendingLocalPhoto[] = [];
  let pendingExternalPhotos: PendingExternalPhoto[] = [];
  let externalUrl = "";
  let saveTaskHandle: ProgressTaskHandle | null = null;

  // Photo edit modal
  let editingPhoto: PhotoItem | null = null;
  let editPhotoTitle = "";
  let editPhotoDesc = "";

  // Drag state
  let dragIndex: number | null = null;
  let lastGalleryReadySignature = "";
  let galleryReadyFrameHandle: number | null = null;

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */
  type ApiResult = {
    response: Response;
    data: Record<string, unknown> | null;
  };

  type UploadPermissionState = {
    can_upload_files?: boolean;
    can_manage_albums?: boolean;
  };

  const pendingCount = (): number =>
    pendingLocalPhotos.length + pendingExternalPhotos.length;

  const totalPhotoCount = (): number => mPhotos.length + pendingCount();

  function createPendingId(): string {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function normalizeApiUrl(input: string): string {
    const [pathname, search = ""] = String(input || "").split("?");
    const normalizedPath = pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
    return search ? `${normalizedPath}?${search}` : normalizedPath;
  }

  async function api(url: string, init: RequestInit = {}): Promise<ApiResult> {
    const isFormData =
      typeof FormData !== "undefined" &&
      Boolean(init.body) &&
      init.body instanceof FormData;
    const response = await fetch(normalizeApiUrl(url), {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "x-csrf-token": getCsrfToken(),
        ...(init.body && !isFormData
          ? { "Content-Type": "application/json" }
          : {}),
        ...((init.headers as Record<string, string>) || {}),
      },
      ...init,
    });
    const data: Record<string, unknown> | null = await response
      .json()
      .catch(() => null);
    return { response, data };
  }

  function getApiMessage(
    data: Record<string, unknown> | null,
    fallback = "未知错误",
  ): string {
    const error = data?.error as Record<string, unknown> | undefined;
    const message = error?.message;
    return typeof message === "string" && message.trim() ? message : fallback;
  }

  function extractFileId(payload: Record<string, unknown> | null): string {
    const directId = payload?.id;
    if (typeof directId === "string" && directId.trim()) {
      return directId.trim();
    }
    const file = payload?.file;
    if (file && typeof file === "object") {
      const nestedId = (file as { id?: unknown }).id;
      if (typeof nestedId === "string" && nestedId.trim()) {
        return nestedId.trim();
      }
    }
    return "";
  }

  function toOptionalText(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized ? normalized : null;
  }

  function toNumberOrNull(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  function toTagsArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    return [];
  }

  function parsePhotoItem(raw: unknown): PhotoItem | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const record = raw as Record<string, unknown>;
    const id = toOptionalText(record.id);
    if (!id) {
      return null;
    }
    return {
      id,
      file_id: toOptionalText(record.file_id),
      image_url: toOptionalText(record.image_url),
      title: toOptionalText(record.title),
      description: toOptionalText(record.description),
      tags: toTagsArray(record.tags),
      location: toOptionalText(record.location),
      sort: toNumberOrNull(record.sort),
    };
  }

  function getImageFileExt(file: File): string {
    const name = String(file.name || "");
    const dotIndex = name.lastIndexOf(".");
    if (dotIndex > -1 && dotIndex < name.length - 1) {
      return name.slice(dotIndex + 1).toLowerCase();
    }
    if (file.type === "image/png") return "png";
    if (file.type === "image/webp") return "webp";
    if (file.type === "image/gif") return "gif";
    return "jpg";
  }

  function buildAlbumPhotoName(albumIdValue: string, index: number): string {
    const normalizedAlbumId = String(albumIdValue || "").trim() || "album";
    const normalizedIndex = String(index).padStart(2, "0");
    return `Albums ${normalizedAlbumId}-${normalizedIndex}`;
  }

  function photoSrc(
    photo: { file_id: string | null; image_url: string | null },
    size = 600,
  ): string {
    if (photo.image_url) return photo.image_url;
    if (photo.file_id) {
      return `${assetUrlPrefix}/${photo.file_id}?width=${size}&height=${size}&fit=cover`;
    }
    return "";
  }

  function photoDisplaySrc(
    photo: { file_id: string | null; image_url: string | null },
    layout: "grid" | "masonry",
  ): string {
    if (layout === "masonry") {
      return photoPreviewSrc(photo) || photoSrc(photo);
    }
    return photoSrc(photo);
  }

  function photoPreviewSrc(photo: {
    file_id: string | null;
    image_url: string | null;
  }): string {
    if (photo.image_url) {
      return photo.image_url;
    }
    if (photo.file_id) {
      return `${assetUrlPrefix}/${photo.file_id}?width=1920`;
    }
    return "";
  }

  function photoCaption(photo: {
    title: string | null;
    description: string | null;
  }): string {
    return [photo.title, photo.description].filter(Boolean).join("\n");
  }

  function buildGoogleMapsSearchUrl(value: string | null | undefined): string {
    const query = String(value || "").trim();
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  function formatAlbumDateDisplay(value: string | null | undefined): string {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return raw;
    }
    return `${parsed.getFullYear()}/${String(parsed.getMonth() + 1).padStart(2, "0")}/${String(parsed.getDate()).padStart(2, "0")}`;
  }

  function flash(msg: string): void {
    saveMsg = msg;
    setTimeout(() => {
      saveMsg = "";
    }, 2500);
  }

  function revokePendingPreview(photoId: string): void {
    const target = pendingLocalPhotos.find((item) => item.id === photoId);
    if (target) {
      URL.revokeObjectURL(target.previewUrl);
    }
  }

  function cleanupAllPendingPreviews(): void {
    for (const item of pendingLocalPhotos) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }

  function removePendingLocalPhoto(photoId: string): void {
    revokePendingPreview(photoId);
    pendingLocalPhotos = pendingLocalPhotos.filter(
      (item) => item.id !== photoId,
    );
  }

  function removePendingExternalPhoto(photoId: string): void {
    pendingExternalPhotos = pendingExternalPhotos.filter(
      (item) => item.id !== photoId,
    );
  }

  function queueLocalFiles(files: File[]): void {
    if (!files.length) {
      return;
    }
    let added = 0;
    let skipped = 0;
    let firstReason = "";

    for (const file of files) {
      if (totalPhotoCount() + added >= ALBUM_PHOTO_MAX) {
        skipped += 1;
        if (!firstReason) {
          firstReason = `相册最多 ${ALBUM_PHOTO_MAX} 张照片`;
        }
        continue;
      }
      if (file.size > UPLOAD_LIMITS["album-photo"]) {
        skipped += 1;
        if (!firstReason) {
          firstReason = `图片超过 ${UPLOAD_LIMIT_LABELS["album-photo"]}`;
        }
        continue;
      }
      pendingLocalPhotos = [
        ...pendingLocalPhotos,
        {
          id: createPendingId(),
          file,
          previewUrl: URL.createObjectURL(file),
        },
      ];
      added += 1;
    }

    if (added > 0 && skipped === 0) {
      flash(`已加入待上传：${added} 张`);
      return;
    }
    if (added > 0) {
      flash(
        `已加入待上传 ${added} 张，跳过 ${skipped} 张${firstReason ? `（${firstReason}）` : ""}`,
      );
      return;
    }
    flash(`未加入图片：${firstReason || "请选择有效图片"}`);
  }

  async function ensureUploadPermissions(): Promise<void> {
    const { response, data } = await api("/api/v1/me/permissions");
    if (!response.ok || !data?.permissions) {
      throw new Error(
        `无法校验上传权限：${getApiMessage(data, response.statusText || "未知错误")}`,
      );
    }
    const permissionState = data.permissions as UploadPermissionState;
    if (permissionState.can_upload_files === false) {
      throw new Error("账号未开启文件上传权限（can_upload_files）");
    }
    if (permissionState.can_manage_albums === false) {
      throw new Error("账号未开启相册管理权限（can_manage_albums）");
    }
  }

  function setSaveProgress(done: number, total: number, text: string): void {
    if (saveTaskHandle === null) {
      return;
    }
    if (total <= 1) {
      updateTask(saveTaskHandle, {
        mode: "indeterminate",
        text,
      });
      return;
    }
    updateTask(saveTaskHandle, {
      mode: "determinate",
      text,
      percent: Math.round((done / total) * 100),
    });
  }

  async function saveAlbum(): Promise<void> {
    if (saving) {
      return;
    }
    saveMsg = "";
    if (weightedCharLength(mTitle) > ALBUM_TITLE_MAX) {
      flash(`标题过长（最多 ${ALBUM_TITLE_MAX} 字符，中文算 2 字符）`);
      return;
    }
    if (totalPhotoCount() > ALBUM_PHOTO_MAX) {
      flash(`保存失败：相册最多 ${ALBUM_PHOTO_MAX} 张照片`);
      return;
    }

    saving = true;
    const localQueue = [...pendingLocalPhotos];
    const externalQueue = [...pendingExternalPhotos];
    const totalSteps = 1 + localQueue.length * 2 + externalQueue.length;
    saveTaskHandle = startTask({
      title: "正在保存相册",
      mode: totalSteps > 1 ? "determinate" : "indeterminate",
      percent: 0,
      text: "保存相册信息...",
    });
    let doneSteps = 0;
    setSaveProgress(doneSteps, totalSteps, "保存相册信息...");

    try {
      const metadataPayload: Record<string, unknown> = {
        title: mTitle,
        description: mDescription || null,
        category: mCategory || null,
        tags: mTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        date: mDate || null,
        location: mLocation || null,
        layout: mLayout,
        is_public: mIsPublic,
      };
      const { response: metadataRes, data: metadataData } = await api(
        `/api/v1/me/albums/${albumId}`,
        {
          method: "PATCH",
          body: JSON.stringify(metadataPayload),
        },
      );
      if (!metadataRes.ok) {
        throw new Error(
          `保存信息失败：${getApiMessage(metadataData, metadataRes.statusText || "未知错误")}`,
        );
      }
      const updatedItem = metadataData?.item as
        | Record<string, unknown>
        | undefined;
      if (updatedItem) {
        mTitle = toOptionalText(updatedItem.title) || "";
        mDescription = toOptionalText(updatedItem.description) || "";
        mCategory = toOptionalText(updatedItem.category) || "";
        mDate = toOptionalText(updatedItem.date) || "";
        mLocation = toOptionalText(updatedItem.location) || "";
        mLayout = updatedItem.layout === "masonry" ? "masonry" : "grid";
        mStatus = updatedItem.status === "published" ? "published" : "private";
        mIsPublic = Boolean(updatedItem.is_public);
        mTags = toTagsArray(updatedItem.tags).join(", ");
      }
      doneSteps += 1;
      setSaveProgress(doneSteps, totalSteps, "相册信息已保存");

      if (localQueue.length > 0 || externalQueue.length > 0) {
        await ensureUploadPermissions();
      }

      let currentPhotoCount = mPhotos.length;
      for (let i = 0; i < localQueue.length; i++) {
        if (currentPhotoCount >= ALBUM_PHOTO_MAX) {
          throw new Error(`保存失败：相册最多 ${ALBUM_PHOTO_MAX} 张照片`);
        }
        const pending = localQueue[i];
        const fileIndex = currentPhotoCount + 1;
        const fileBaseName = buildAlbumPhotoName(
          albumShortId || albumId,
          fileIndex,
        );
        const fileExt = getImageFileExt(pending.file);

        setSaveProgress(
          doneSteps,
          totalSteps,
          `上传图片 ${i + 1}/${localQueue.length}...`,
        );
        const uploadForm = new FormData();
        uploadForm.append("file", pending.file, `${fileBaseName}.${fileExt}`);
        uploadForm.append("title", fileBaseName);
        uploadForm.append("purpose", "album-photo");
        const { response: uploadRes, data: uploadData } = await api(
          "/api/v1/uploads",
          { method: "POST", body: uploadForm },
        );
        if (!uploadRes.ok) {
          throw new Error(
            `上传图片失败：${getApiMessage(uploadData, uploadRes.statusText || "未知错误")}`,
          );
        }
        const fileId = extractFileId(uploadData);
        if (!fileId) {
          throw new Error("上传图片失败：无文件 ID");
        }
        doneSteps += 1;

        setSaveProgress(
          doneSteps,
          totalSteps,
          `写入相册 ${i + 1}/${localQueue.length}...`,
        );
        const { response: photoRes, data: photoData } = await api(
          `/api/v1/me/albums/${albumId}/photos`,
          {
            method: "POST",
            body: JSON.stringify({ file_id: fileId }),
          },
        );
        if (!photoRes.ok) {
          throw new Error(
            `写入相册失败：${getApiMessage(photoData, photoRes.statusText || "未知错误")}`,
          );
        }
        const createdPhoto = parsePhotoItem(photoData?.item);
        if (!createdPhoto) {
          throw new Error("写入相册失败：返回数据异常");
        }
        mPhotos = [...mPhotos, createdPhoto];
        currentPhotoCount += 1;
        doneSteps += 1;
        revokePendingPreview(pending.id);
        pendingLocalPhotos = pendingLocalPhotos.filter(
          (item) => item.id !== pending.id,
        );
      }

      for (let i = 0; i < externalQueue.length; i++) {
        if (currentPhotoCount >= ALBUM_PHOTO_MAX) {
          throw new Error(`保存失败：相册最多 ${ALBUM_PHOTO_MAX} 张照片`);
        }
        const pending = externalQueue[i];
        setSaveProgress(
          doneSteps,
          totalSteps,
          `写入外链图片 ${i + 1}/${externalQueue.length}...`,
        );
        const { response: photoRes, data: photoData } = await api(
          `/api/v1/me/albums/${albumId}/photos`,
          {
            method: "POST",
            body: JSON.stringify({ image_url: pending.url }),
          },
        );
        if (!photoRes.ok) {
          throw new Error(
            `写入外链图片失败：${getApiMessage(photoData, photoRes.statusText || "未知错误")}`,
          );
        }
        const createdPhoto = parsePhotoItem(photoData?.item);
        if (!createdPhoto) {
          throw new Error("写入外链图片失败：返回数据异常");
        }
        mPhotos = [...mPhotos, createdPhoto];
        currentPhotoCount += 1;
        doneSteps += 1;
        pendingExternalPhotos = pendingExternalPhotos.filter(
          (item) => item.id !== pending.id,
        );
      }

      setSaveProgress(totalSteps, totalSteps, "保存完成");
      await new Promise((resolve) => setTimeout(resolve, 180));
      externalUrl = "";
      editing = false;
      flash("相册已保存");
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      flash(message);
    } finally {
      saving = false;
      if (saveTaskHandle !== null) {
        finishTask(saveTaskHandle);
        saveTaskHandle = null;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Delete album                                                       */
  /* ------------------------------------------------------------------ */
  async function deleteAlbum(): Promise<void> {
    const confirmed = await showConfirmDialog({
      message: "确认删除这个相册？删除后不可恢复。",
      confirmVariant: "danger",
    });
    if (!confirmed) return;
    try {
      const { response, data } = await api(`/api/v1/me/albums/${albumId}`, {
        method: "DELETE",
      });
      if (!response.ok || !data?.ok) {
        await showNoticeDialog({ message: getApiMessage(data, "删除失败") });
        return;
      }
      navigateToPage(`/${username}/albums`, { force: true, replace: true });
    } catch {
      await showNoticeDialog({ message: "网络错误" });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Queue photos (local + external)                                   */
  /* ------------------------------------------------------------------ */
  function handleFileUpload(e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    if (!files.length) {
      return;
    }
    queueLocalFiles(files);
    input.value = "";
  }

  function addExternalPhoto(): void {
    const url = externalUrl.trim();
    if (!url) return;
    if (totalPhotoCount() >= ALBUM_PHOTO_MAX) {
      flash(`添加失败：相册最多 ${ALBUM_PHOTO_MAX} 张照片`);
      return;
    }
    pendingExternalPhotos = [
      ...pendingExternalPhotos,
      { id: createPendingId(), url },
    ];
    externalUrl = "";
    flash("外链已加入待上传队列");
  }

  $: {
    const nextTags = mTags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    displayTags = nextTags;
  }

  /* ------------------------------------------------------------------ */
  /* Photo actions (saved items)                                        */
  /* ------------------------------------------------------------------ */
  async function deletePhoto(photoId: string): Promise<void> {
    if (!confirm("确定删除该照片？")) return;
    try {
      const { response } = await api(
        `/api/v1/me/albums/${albumId}/photos/${photoId}`,
        { method: "DELETE" },
      );
      if (response.ok) {
        mPhotos = mPhotos.filter((p) => p.id !== photoId);
        flash("已删除");
      } else {
        flash("删除失败");
      }
    } catch {
      flash("网络错误");
    }
  }

  async function setCover(photo: {
    file_id: string | null;
    image_url: string | null;
  }): Promise<void> {
    try {
      const payload: Record<string, unknown> = {};
      if (photo.file_id) {
        payload.cover_file = photo.file_id;
        payload.cover_url = null;
      } else if (photo.image_url) {
        payload.cover_url = photo.image_url;
        payload.cover_file = null;
      }
      const { response } = await api(`/api/v1/me/albums/${albumId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        album.cover_file = (payload.cover_file as string | null) ?? null;
        album.cover_url = (payload.cover_url as string | null) ?? null;
        album = album;
        flash("已设为封面");
      } else {
        flash("设封面失败");
      }
    } catch {
      flash("网络错误");
    }
  }

  function openEditPhoto(photo: PhotoItem): void {
    editingPhoto = photo;
    editPhotoTitle = photo.title || "";
    editPhotoDesc = photo.description || "";
  }

  async function savePhotoEdit(): Promise<void> {
    if (!editingPhoto) return;
    try {
      const { response } = await api(
        `/api/v1/me/albums/${albumId}/photos/${editingPhoto.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: editPhotoTitle || null,
            description: editPhotoDesc || null,
          }),
        },
      );
      if (response.ok) {
        const idx = mPhotos.findIndex((p) => p.id === editingPhoto?.id);
        if (idx >= 0) {
          mPhotos[idx] = {
            ...mPhotos[idx],
            title: editPhotoTitle || null,
            description: editPhotoDesc || null,
          };
          mPhotos = [...mPhotos];
        }
        flash("已保存");
      } else {
        flash("保存失败");
      }
    } catch {
      flash("网络错误");
    }
    editingPhoto = null;
  }

  /* ------------------------------------------------------------------ */
  /* Drag & drop sort                                                   */
  /* ------------------------------------------------------------------ */
  function onDragStart(index: number): void {
    dragIndex = index;
  }

  function getGalleryReadySignature(): string {
    return `${editing ? "1" : "0"}:${mPhotos.length}:${mLayout}`;
  }

  function dispatchAlbumGalleryReady(): void {
    if (typeof document === "undefined") {
      return;
    }
    document.dispatchEvent(new CustomEvent("cialli:album-gallery:ready"));
  }

  function scheduleAlbumGalleryReady(force = false): void {
    if (
      typeof window === "undefined" ||
      typeof requestAnimationFrame !== "function"
    ) {
      return;
    }
    if (editing || mPhotos.length === 0) {
      return;
    }

    const signature = getGalleryReadySignature();
    if (!force && signature === lastGalleryReadySignature) {
      return;
    }
    lastGalleryReadySignature = signature;

    if (galleryReadyFrameHandle !== null) {
      cancelAnimationFrame(galleryReadyFrameHandle);
    }
    galleryReadyFrameHandle = requestAnimationFrame(() => {
      galleryReadyFrameHandle = null;
      dispatchAlbumGalleryReady();
    });
  }

  function onDragOver(e: DragEvent, index: number): void {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const dragged = mPhotos[dragIndex];
    const updated = mPhotos.filter((_, i) => i !== dragIndex);
    updated.splice(index, 0, dragged);
    mPhotos = updated;
    dragIndex = index;
  }

  async function onDragEnd(): Promise<void> {
    if (dragIndex === null) return;
    dragIndex = null;
    for (let i = 0; i < mPhotos.length; i++) {
      const photo = mPhotos[i];
      if (photo.sort !== i) {
        photo.sort = i;
        api(`/api/v1/me/albums/${albumId}/photos/${photo.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sort: i }),
        }).catch(() => {});
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                          */
  /* ------------------------------------------------------------------ */
  onMount(() => {
    if (initialEditMode && window.location.search.includes("edit=1")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("edit");
      window.history.replaceState({}, "", url.toString());
    }

    void tick().then(() => {
      scheduleAlbumGalleryReady(true);
    });
  });

  $: if (!editing && mPhotos.length > 0) {
    void tick().then(() => {
      scheduleAlbumGalleryReady();
    });
  }

  onDestroy(() => {
    if (
      galleryReadyFrameHandle !== null &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(galleryReadyFrameHandle);
      galleryReadyFrameHandle = null;
    }
    if (saveTaskHandle !== null) {
      finishTask(saveTaskHandle);
      saveTaskHandle = null;
    }
    cleanupAllPendingPreviews();
  });
</script>

<div class="space-y-4">
  {#if isOwner}
    <div
      class="card-base p-3 rounded-(--radius-large) shadow-[0_6px_14px_rgba(15,23,42,0.08)] dark:shadow-[0_6px_14px_rgba(0,0,0,0.24)] flex items-center justify-between gap-3 flex-wrap sticky top-[4.5rem] z-30"
    >
      <div class="flex items-center gap-3 flex-wrap">
        <a
          href={`/${username}/albums`}
          aria-label="返回相册列表"
          title="返回相册列表"
          class="w-9 h-9 rounded-full bg-(--primary) text-white hover:opacity-90 transition flex items-center justify-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </a>

        {#if !editing}
          <button
            on:click={() => {
              editing = true;
            }}
            class="px-4 h-9 rounded-lg text-sm font-medium transition cursor-pointer border border-(--line-divider) text-75 hover:bg-(--btn-plain-bg-hover)"
          >
            编辑相册
          </button>
        {:else}
          <button
            on:click={saveAlbum}
            disabled={saving}
            class="px-4 h-9 rounded-lg text-sm font-medium transition cursor-pointer bg-(--primary) text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "保存中…" : "保存相册"}
          </button>
        {/if}

        {#if saveMsg}
          <span class="text-sm text-(--primary)">{saveMsg}</span>
        {/if}
      </div>

      {#if editing}
        <div class="flex items-center gap-3">
          <span class="text-xs text-50">
            相册状态：{mStatus === "published" ? "已发布" : "私密"}
          </span>
          <button
            on:click={deleteAlbum}
            class="px-4 h-9 rounded-lg text-sm font-medium transition cursor-pointer border border-red-400/60 text-red-500 hover:bg-red-500 hover:text-white"
          >
            删除相册
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <section class="card-base p-6 rounded-(--radius-large) space-y-3 text-90">
    {#if editing}
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1 text-75" for="ed-title"
            >标题</label
          >
          <input
            id="ed-title"
            bind:value={mTitle}
            class="w-full h-10 px-3 rounded-lg border border-(--line-divider) bg-(--card-bg) text-90 focus:outline-none focus:ring-2 focus:ring-(--primary) transition"
          />
          <span
            class="text-xs mt-1 block {weightedCharLength(mTitle) >
            ALBUM_TITLE_MAX
              ? 'text-red-500'
              : 'text-50'}"
            >{weightedCharLength(mTitle)} / {ALBUM_TITLE_MAX}</span
          >
        </div>
        <div>
          <label class="block text-sm font-medium mb-1 text-75" for="ed-desc"
            >描述</label
          >
          <textarea
            id="ed-desc"
            bind:value={mDescription}
            rows="3"
            class="w-full px-3 py-2 rounded-lg border border-(--line-divider) bg-(--card-bg) text-90 focus:outline-none focus:ring-2 focus:ring-(--primary) transition resize-y"
          ></textarea>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium mb-1 text-75" for="ed-cat"
              >分类</label
            >
            <input
              id="ed-cat"
              bind:value={mCategory}
              placeholder="例：旅行"
              class="w-full h-10 px-3 rounded-lg border border-(--line-divider) bg-(--card-bg) text-90 focus:outline-none focus:ring-2 focus:ring-(--primary) transition"
            />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1 text-75" for="ed-tags"
              >标签（逗号分隔）</label
            >
            <input
              id="ed-tags"
              bind:value={mTags}
              placeholder="风景, 街拍"
              class="w-full h-10 px-3 rounded-lg border border-(--line-divider) bg-(--card-bg) text-90 focus:outline-none focus:ring-2 focus:ring-(--primary) transition"
            />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1 text-75" for="ed-date"
              >日期</label
            >
            <input
              id="ed-date"
              type="date"
              bind:value={mDate}
              on:keydown|preventDefault={() => {}}
              on:paste|preventDefault={() => {}}
              class="date-picker-input w-full h-10 px-3 rounded-lg border border-(--line-divider) bg-(--card-bg) text-90 focus:outline-none focus:ring-2 focus:ring-(--primary) transition"
            />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1 text-75" for="ed-loc"
              >地点</label
            >
            <input
              id="ed-loc"
              bind:value={mLocation}
              placeholder="例：东京"
              class="w-full h-10 px-3 rounded-lg border border-(--line-divider) bg-(--card-bg) text-90 focus:outline-none focus:ring-2 focus:ring-(--primary) transition"
            />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label
              class="block text-sm font-medium mb-1 text-75"
              for="ed-layout">布局</label
            >
            <select
              id="ed-layout"
              bind:value={mLayout}
              class="w-full h-10 px-3 rounded-lg border border-(--line-divider) bg-(--card-bg) text-90 focus:outline-none focus:ring-2 focus:ring-(--primary) transition cursor-pointer"
            >
              <option value="grid">网格</option>
              <option value="masonry">瀑布流</option>
            </select>
          </div>
        </div>
        <div class="flex items-center gap-3 text-75 cursor-pointer select-none">
          <label
            class="flex items-center gap-3 text-75 cursor-pointer select-none"
          >
            <input
              type="checkbox"
              bind:checked={mIsPublic}
              class="toggle-checkbox"
            />
            <span class="toggle-track"><span class="toggle-knob"></span></span>
            公开此相册
          </label>
        </div>
      </div>
    {:else}
      <h1 class="text-3xl font-bold">{mTitle}</h1>
      <div class="text-xs text-60 flex flex-wrap items-center gap-2">
        {#if mDate}<span>{formatAlbumDateDisplay(mDate)}</span>{/if}
        {#if mLocation}
          <a
            href={buildGoogleMapsSearchUrl(mLocation)}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors hover:bg-(--btn-plain-bg-hover) active:bg-(--btn-plain-bg-active) hover:text-(--primary)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 22s8-6.2 8-12a8 8 0 10-16 0c0 5.8 8 12 8 12z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {mLocation}
          </a>
        {/if}
        {#if mCategory}<span
            class="px-2 py-0.5 rounded bg-(--btn-plain-bg-hover) text-75"
            >{mCategory}</span
          >{/if}
        {#if displayTags.length > 0}
          {#each displayTags as tag (tag)}
            <span class="btn-regular h-7 text-xs px-3 rounded-lg">#{tag}</span>
          {/each}
        {/if}
      </div>
      {#if mDescription}
        <p class="text-75">{mDescription}</p>
      {/if}
    {/if}
  </section>

  {#if editing}
    <section class="card-base p-5 rounded-(--radius-large) space-y-3 text-90">
      <h3 class="text-sm font-semibold text-75">
        上传图片（上传后点击保存生效）
      </h3>
      <div class="flex flex-wrap items-end gap-3">
        <label
          class="px-4 h-9 rounded-lg text-sm font-medium cursor-pointer bg-(--primary) text-white hover:opacity-90 transition flex items-center gap-1.5 {saving
            ? 'opacity-50 pointer-events-none'
            : ''}"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline
              points="17 8 12 3 7 8"
            /><line x1="12" y1="3" x2="12" y2="15" /></svg
          >
          选择图片
          <input
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            on:change={handleFileUpload}
            disabled={saving}
          />
        </label>
        <div class="flex items-center gap-2 flex-1 min-w-[220px]">
          <input
            type="url"
            bind:value={externalUrl}
            placeholder="粘贴图片外链 URL"
            disabled={saving}
            class="flex-1 h-9 px-3 rounded-lg border border-(--line-divider) bg-(--card-bg) text-sm text-90 focus:outline-none focus:ring-2 focus:ring-(--primary) transition"
          />
          <button
            on:click={addExternalPhoto}
            disabled={saving || !externalUrl.trim()}
            class="px-3 h-9 rounded-lg text-sm border border-(--line-divider) text-75 hover:bg-(--btn-plain-bg-hover) transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            加入队列
          </button>
        </div>
      </div>

      <div class="text-xs text-60">
        当前已保存 {mPhotos.length} 张，待上传 {pendingCount()} 张（相册总容量 {ALBUM_PHOTO_MAX}
        张）
      </div>

      {#if pendingLocalPhotos.length > 0}
        <div class="space-y-2">
          <p class="text-xs text-60">待上传本地图片</p>
          <div class="grid grid-cols-2 gap-2">
            {#each pendingLocalPhotos as item (item.id)}
              <div
                class="relative rounded-lg overflow-hidden border border-(--line-divider) bg-(--card-bg)"
              >
                <img
                  src={item.previewUrl}
                  alt={item.file.name}
                  class="w-full h-24 object-cover"
                  loading="lazy"
                />
                <button
                  on:click={() => removePendingLocalPhoto(item.id)}
                  type="button"
                  class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs"
                  aria-label="移除待上传图片"
                >
                  ×
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if pendingExternalPhotos.length > 0}
        <div class="space-y-2">
          <p class="text-xs text-60">待上传外链图片</p>
          <div class="space-y-1">
            {#each pendingExternalPhotos as item (item.id)}
              <div
                class="flex items-center gap-2 rounded-lg border border-(--line-divider) px-2 py-1.5"
              >
                <span class="text-xs text-75 truncate flex-1">{item.url}</span>
                <button
                  type="button"
                  on:click={() => removePendingExternalPhoto(item.id)}
                  class="text-xs text-red-500 hover:underline"
                >
                  移除
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </section>
  {/if}

  {#if mPhotos.length === 0}
    <div class="card-base p-8 rounded-(--radius-large) text-70">
      {editing
        ? "尚未添加照片。可先加入待上传队列，再点击“保存相册”。"
        : "该相册暂无可展示照片。"}
    </div>
  {:else}
    <div
      class={mLayout === "masonry"
        ? "dc-album-gallery columns-3 gap-3"
        : "dc-album-gallery grid grid-cols-2 lg:grid-cols-4 gap-3"}
    >
      {#each mPhotos as photo, index (photo.id)}
        <figure
          class="rounded-xl overflow-hidden border border-(--line-divider) bg-(--card-bg) relative group {mLayout ===
          'masonry'
            ? 'mb-3 break-inside-avoid'
            : ''}"
          draggable={editing ? "true" : "false"}
          on:dragstart={() => onDragStart(index)}
          on:dragover={(e) => onDragOver(e, index)}
          on:dragend={onDragEnd}
        >
          {#if photoDisplaySrc(photo, mLayout)}
            {#if !editing}
              <a
                href={photoPreviewSrc(photo) || photoDisplaySrc(photo, mLayout)}
                data-fancybox="album-photo-preview"
                data-caption={photoCaption(photo) || undefined}
                class="block relative"
              >
                <img
                  src={photoDisplaySrc(photo, mLayout)}
                  alt={photo.title || "album photo"}
                  class="w-full h-auto object-cover"
                  loading="lazy"
                />
                {#if (photo.title || photo.description) && mLayout === "grid"}
                  <div
                    class="absolute inset-x-0 bottom-0 p-3 space-y-1 text-white bg-linear-to-t from-black/70 via-black/35 to-transparent"
                  >
                    {#if photo.title}<div
                        class="text-sm font-medium line-clamp-1"
                      >
                        {photo.title}
                      </div>{/if}
                    {#if photo.description}<div
                        class="text-xs text-white/85 line-clamp-2"
                      >
                        {photo.description}
                      </div>{/if}
                  </div>
                {/if}
              </a>
            {:else}
              <img
                src={photoDisplaySrc(photo, mLayout)}
                alt={photo.title || "album photo"}
                class="w-full h-auto object-cover"
                loading="lazy"
              />
            {/if}
          {/if}
          {#if !editing && (photo.title || photo.description) && mLayout !== "grid"}
            <figcaption class="p-3 space-y-1 text-90">
              {#if photo.title}<div class="text-sm font-medium">
                  {photo.title}
                </div>{/if}
              {#if photo.description}<div class="text-xs text-60">
                  {photo.description}
                </div>{/if}
            </figcaption>
          {/if}

          {#if editing}
            <div
              class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100"
            >
              <div class="flex items-center gap-2">
                <button
                  on:click={() => setCover(photo)}
                  class="w-8 h-8 rounded-full bg-white/90 text-black flex items-center justify-center hover:bg-white transition cursor-pointer"
                  title="设为封面"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    ><rect x="3" y="3" width="18" height="18" rx="2" /><circle
                      cx="8.5"
                      cy="8.5"
                      r="1.5"
                    /><path d="M21 15l-5-5L5 21" /></svg
                  >
                </button>
                <button
                  on:click={() => openEditPhoto(photo)}
                  class="w-8 h-8 rounded-full bg-white/90 text-black flex items-center justify-center hover:bg-white transition cursor-pointer"
                  title="编辑信息"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    ><path
                      d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
                    /><path
                      d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
                    /></svg
                  >
                </button>
                <button
                  on:click={() => deletePhoto(photo.id)}
                  class="w-8 h-8 rounded-full bg-red-500/90 text-white flex items-center justify-center hover:bg-red-600 transition cursor-pointer"
                  title="删除"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    ><polyline points="3 6 5 6 21 6" /><path
                      d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
                    /></svg
                  >
                </button>
              </div>
            </div>
            <div
              class="absolute top-2 left-2 w-6 h-6 rounded bg-black/50 text-white flex items-center justify-center cursor-grab opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="currentColor"
                ><circle cx="9" cy="5" r="1.5" /><circle
                  cx="15"
                  cy="5"
                  r="1.5"
                /><circle cx="9" cy="12" r="1.5" /><circle
                  cx="15"
                  cy="12"
                  r="1.5"
                /><circle cx="9" cy="19" r="1.5" /><circle
                  cx="15"
                  cy="19"
                  r="1.5"
                /></svg
              >
            </div>
          {/if}
        </figure>
      {/each}
    </div>
  {/if}
</div>

{#if editingPhoto}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    on:click|self={() => {
      editingPhoto = null;
    }}
  >
    <div
      class="bg-(--card-bg) rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl"
    >
      <h3 class="text-lg font-bold text-90">编辑照片信息</h3>
      <div>
        <label class="block text-sm font-medium mb-1 text-75" for="ph-title"
          >照片标题</label
        >
        <input
          id="ph-title"
          bind:value={editPhotoTitle}
          class="w-full h-10 px-3 rounded-lg border border-(--line-divider) bg-(--card-bg) text-90 focus:outline-none focus:ring-2 focus:ring-(--primary) transition"
        />
      </div>
      <div>
        <label class="block text-sm font-medium mb-1 text-75" for="ph-desc"
          >照片描述</label
        >
        <textarea
          id="ph-desc"
          bind:value={editPhotoDesc}
          rows="3"
          class="w-full px-3 py-2 rounded-lg border border-(--line-divider) bg-(--card-bg) text-90 focus:outline-none focus:ring-2 focus:ring-(--primary) transition resize-y"
        ></textarea>
      </div>
      <div class="flex justify-end gap-3">
        <button
          on:click={() => {
            editingPhoto = null;
          }}
          class="px-4 h-9 rounded-lg text-sm border border-(--line-divider) text-75 hover:bg-(--btn-plain-bg-hover) transition cursor-pointer"
        >
          取消
        </button>
        <button
          on:click={savePhotoEdit}
          class="px-4 h-9 rounded-lg text-sm bg-(--primary) text-white hover:opacity-90 transition cursor-pointer"
        >
          保存
        </button>
      </div>
    </div>
  </div>
{/if}
