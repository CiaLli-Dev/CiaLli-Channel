<script lang="ts">
  /* eslint-disable max-lines -- 文件行数较长，按页面驱动与模块边界保留当前结构 */
  import { onDestroy, onMount, tick } from "svelte";
  import { showConfirmDialog, showNoticeDialog } from "@/scripts/dialogs";
  import {
    finishTask,
    startTask,
    updateTask,
    type ProgressTaskHandle,
  } from "@/scripts/progress-overlay-manager";
  import { navigateToPage } from "@/utils/navigation-utils";
  import {
    UPLOAD_LIMITS,
    UPLOAD_LIMIT_LABELS,
  } from "@/constants/upload-limits";
  import {
    api,
    createPendingId,
    getApiMessage,
    ensureUploadPermissions,
    submitAlbumMetadataHelper,
    processLocalQueueHelper,
    processExternalQueueHelper,
    type PhotoItem,
    type PendingLocalPhoto,
    type PendingExternalPhoto,
  } from "@/scripts/album-editor-helpers";
  import AlbumPhotoEditModal from "./AlbumPhotoEditModal.svelte";
  import AlbumPhotoGallery from "./AlbumPhotoGallery.svelte";
  import AlbumUploadSection from "./AlbumUploadSection.svelte";
  import AlbumMetadataSection from "./AlbumMetadataSection.svelte";
  import AlbumToolbar from "./AlbumToolbar.svelte";
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
  let displayTags: string[];

  // Photos (saved)
  let mPhotos = [...photos];

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
  const pendingCount = (): number =>
    pendingLocalPhotos.length + pendingExternalPhotos.length;

  const totalPhotoCount = (): number => mPhotos.length + pendingCount();

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

  function setSaveProgress(done: number, total: number, text: string): void {
    if (saveTaskHandle === null) {
      return;
    }
    if (total <= 1) {
      updateTask(saveTaskHandle, { mode: "indeterminate", text });
      return;
    }
    updateTask(saveTaskHandle, {
      mode: "determinate",
      text,
      percent: Math.round((done / total) * 100),
    });
  }

  async function saveAlbum(): Promise<void> {
    if (saving) return;
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
      const { next, result } = await submitAlbumMetadataHelper(
        albumId,
        {
          title: mTitle,
          description: mDescription,
          category: mCategory,
          tags: mTags,
          date: mDate,
          location: mLocation,
          layout: mLayout,
          isPublic: mIsPublic,
        },
        doneSteps,
        totalSteps,
        setSaveProgress,
      );
      doneSteps = next;
      if (result) {
        mTitle = result.title;
        mDescription = result.description;
        mCategory = result.category;
        mDate = result.date;
        mLocation = result.location;
        mLayout = result.layout;
        mStatus = result.status as "private" | "published";
        mIsPublic = result.isPublic;
        mTags = result.tags;
      }
      if (localQueue.length > 0 || externalQueue.length > 0)
        await ensureUploadPermissions();
      let currentPhotoCount = mPhotos.length;
      doneSteps = await processLocalQueueHelper(
        albumId,
        albumShortId,
        localQueue,
        currentPhotoCount,
        doneSteps,
        totalSteps,
        setSaveProgress,
        (photo) => {
          mPhotos = [...mPhotos, photo];
        },
        (id) => {
          pendingLocalPhotos = pendingLocalPhotos.filter(
            (item) => item.id !== id,
          );
        },
      );
      currentPhotoCount += localQueue.length;
      await processExternalQueueHelper(
        albumId,
        externalQueue,
        currentPhotoCount,
        doneSteps,
        totalSteps,
        setSaveProgress,
        (photo) => {
          mPhotos = [...mPhotos, photo];
        },
        (id) => {
          pendingExternalPhotos = pendingExternalPhotos.filter(
            (item) => item.id !== id,
          );
        },
      );
      setSaveProgress(totalSteps, totalSteps, "保存完成");
      await new Promise((resolve) => setTimeout(resolve, 180));
      externalUrl = "";
      editing = false;
      flash("相册已保存");
    } catch (error) {
      flash(error instanceof Error ? error.message : "保存失败");
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
    <AlbumToolbar
      {username}
      {editing}
      {saving}
      {saveMsg}
      {mStatus}
      onStartEdit={() => {
        editing = true;
      }}
      onSave={saveAlbum}
      onDelete={deleteAlbum}
    />
  {/if}

  <AlbumMetadataSection
    {editing}
    bind:mTitle
    bind:mDescription
    bind:mCategory
    bind:mTags
    bind:mDate
    bind:mLocation
    bind:mLayout
    bind:mIsPublic
    {displayTags}
  />

  {#if editing}
    <AlbumUploadSection
      {saving}
      savedPhotoCount={mPhotos.length}
      {pendingLocalPhotos}
      {pendingExternalPhotos}
      bind:externalUrl
      onFileUpload={handleFileUpload}
      onAddExternal={addExternalPhoto}
      onRemoveLocal={removePendingLocalPhoto}
      onRemoveExternal={removePendingExternalPhoto}
    />
  {/if}

  <AlbumPhotoGallery
    photos={mPhotos}
    layout={mLayout}
    {editing}
    {assetUrlPrefix}
    {onDragStart}
    {onDragOver}
    {onDragEnd}
    onSetCover={setCover}
    onEditPhoto={openEditPhoto}
    onDeletePhoto={deletePhoto}
  />
</div>

{#if editingPhoto}
  <AlbumPhotoEditModal
    bind:editPhotoTitle
    bind:editPhotoDesc
    onSave={savePhotoEdit}
    onCancel={() => {
      editingPhoto = null;
    }}
  />
{/if}
