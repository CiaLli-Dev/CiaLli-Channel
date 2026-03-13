<script lang="ts">
  import {
    photoCaption,
    photoDisplaySrc,
    photoPreviewSrc,
    type PhotoItem,
  } from "@/scripts/album-editor-helpers";

  export let photos: PhotoItem[];
  export let layout: "grid" | "masonry";
  export let editing: boolean;
  export let assetUrlPrefix: string;
  export let onDragStart: (index: number) => void;
  export let onDragOver: (e: DragEvent, index: number) => void;
  export let onDragEnd: () => void;
  export let onSetCover: (photo: PhotoItem) => void;
  export let onEditPhoto: (photo: PhotoItem) => void;
  export let onDeletePhoto: (id: string) => void;
</script>

{#if photos.length === 0}
  <div class="card-base p-8 rounded-(--radius-large) text-70">
    {editing
      ? "尚未添加照片。可先加入待上传队列，再点击\u201c保存相册\u201d。"
      : "该相册暂无可展示照片。"}
  </div>
{:else}
  <div
    class={layout === "masonry"
      ? "dc-album-gallery columns-3 gap-3"
      : "dc-album-gallery grid grid-cols-2 lg:grid-cols-4 gap-3"}
  >
    {#each photos as photo, index (photo.id)}
      <figure
        class="rounded-xl overflow-hidden border border-(--line-divider) bg-(--card-bg) relative group {layout ===
        'masonry'
          ? 'mb-3 break-inside-avoid'
          : ''}"
        draggable={editing ? "true" : "false"}
        on:dragstart={() => onDragStart(index)}
        on:dragover={(e) => onDragOver(e, index)}
        on:dragend={onDragEnd}
      >
        {#if photoDisplaySrc(photo, layout, assetUrlPrefix)}
          {#if !editing}
            <a
              href={photoPreviewSrc(photo, assetUrlPrefix) ||
                photoDisplaySrc(photo, layout, assetUrlPrefix)}
              data-fancybox="album-photo-preview"
              data-caption={photoCaption(photo) || undefined}
              class="block relative"
            >
              <img
                src={photoDisplaySrc(photo, layout, assetUrlPrefix)}
                alt={photo.title || "album photo"}
                class="w-full h-auto object-cover"
                loading="lazy"
              />
              {#if (photo.title || photo.description) && layout === "grid"}
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
              src={photoDisplaySrc(photo, layout, assetUrlPrefix)}
              alt={photo.title || "album photo"}
              class="w-full h-auto object-cover"
              loading="lazy"
            />
          {/if}
        {/if}
        {#if !editing && (photo.title || photo.description) && layout !== "grid"}
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
                on:click={() => onSetCover(photo)}
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
                on:click={() => onEditPhoto(photo)}
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
                on:click={() => onDeletePhoto(photo.id)}
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
