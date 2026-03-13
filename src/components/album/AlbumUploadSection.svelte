<script lang="ts">
  import { ALBUM_PHOTO_MAX } from "@/constants/text-limits";
  import type {
    PendingLocalPhoto,
    PendingExternalPhoto,
  } from "@/scripts/album-editor-helpers";

  export let saving: boolean;
  export let savedPhotoCount: number;
  export let pendingLocalPhotos: PendingLocalPhoto[];
  export let pendingExternalPhotos: PendingExternalPhoto[];
  export let externalUrl: string;
  export let onFileUpload: (e: Event) => void;
  export let onAddExternal: () => void;
  export let onRemoveLocal: (id: string) => void;
  export let onRemoveExternal: (id: string) => void;

  $: pendingCount = pendingLocalPhotos.length + pendingExternalPhotos.length;
</script>

<section class="card-base p-5 rounded-(--radius-large) space-y-3 text-90">
  <h3 class="text-sm font-semibold text-75">上传图片（上传后点击保存生效）</h3>
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
        on:change={onFileUpload}
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
        on:click={onAddExternal}
        disabled={saving || !externalUrl.trim()}
        class="px-3 h-9 rounded-lg text-sm border border-(--line-divider) text-75 hover:bg-(--btn-plain-bg-hover) transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >加入队列</button
      >
    </div>
  </div>
  <div class="text-xs text-60">
    当前已保存 {savedPhotoCount} 张，待上传 {pendingCount} 张（相册总容量 {ALBUM_PHOTO_MAX}
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
              on:click={() => onRemoveLocal(item.id)}
              type="button"
              class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs"
              aria-label="移除待上传图片">×</button
            >
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
              on:click={() => onRemoveExternal(item.id)}
              class="text-xs text-red-500 hover:underline">移除</button
            >
          </div>
        {/each}
      </div>
    </div>
  {/if}
</section>
