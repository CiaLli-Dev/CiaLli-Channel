<script lang="ts">
  import { ALBUM_TITLE_MAX, weightedCharLength } from "@/constants/text-limits";
  import {
    buildGoogleMapsSearchUrl,
    formatAlbumDateDisplay,
  } from "@/scripts/album-editor-helpers";

  export let editing: boolean;
  export let mTitle: string;
  export let mDescription: string;
  export let mCategory: string;
  export let mTags: string;
  export let mDate: string;
  export let mLocation: string;
  export let mLayout: "grid" | "masonry";
  export let mIsPublic: boolean;
  export let displayTags: string[];
</script>

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
            : 'text-50'}">{weightedCharLength(mTitle)} / {ALBUM_TITLE_MAX}</span
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
          <label class="block text-sm font-medium mb-1 text-75" for="ed-layout"
            >布局</label
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
            ><path
              d="M12 22s8-6.2 8-12a8 8 0 10-16 0c0 5.8 8 12 8 12z"
            /><circle cx="12" cy="10" r="3" /></svg
          >
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
    {#if mDescription}<p class="text-75">{mDescription}</p>{/if}
  {/if}
</section>
