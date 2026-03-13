<script lang="ts">
  import Icon from "@iconify/svelte";
  import { slide } from "svelte/transition";
  import Key from "../../../i18n/i18nKey";
  import { i18n } from "../../../i18n/translation";
  import { getAssetPath } from "../../../scripts/music-player-helpers";
  import type { Song } from "../../../scripts/music-player-helpers";

  export let playlist: Song[];
  export let currentIndex: number;
  export let isPlaying: boolean;
  export let onClose: () => void;
  export let onPlay: (index: number) => void;
</script>

<div
  class="playlist-panel absolute bottom-full left-0 mb-4 w-full max-h-96 overflow-hidden z-50"
  transition:slide={{ duration: 300, axis: "y" }}
>
  <div
    class="playlist-header flex items-center justify-between p-4 border-b border-(--line-divider)"
  >
    <h3 class="text-lg font-semibold text-90">
      {i18n(Key.coreMusicPlayerPlaylist)}
    </h3>
    <button
      class="btn-plain w-8 h-8 rounded-lg"
      on:click={onClose}
      aria-label="关闭播放列表"
    >
      <Icon icon="material-symbols:close" class="text-lg" />
    </button>
  </div>
  <div class="playlist-content overflow-y-auto max-h-80">
    {#each playlist as song, index (`${song.id}-${index}`)}
      <div
        class="playlist-item flex items-center gap-3 p-3 hover:bg-(--btn-plain-bg-hover) cursor-pointer transition-colors"
        class:bg-(--btn-plain-bg)={index === currentIndex}
        class:text-(--primary)={index === currentIndex}
        on:click={() => onPlay(index)}
        on:keydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPlay(index);
          }
        }}
        role="button"
        tabindex="0"
        aria-label="播放 {song.title} - {song.artist}"
      >
        <div class="w-6 h-6 flex items-center justify-center">
          {#if index === currentIndex && isPlaying}
            <Icon
              icon="material-symbols:graphic-eq"
              class="text-(--primary) animate-pulse"
            />
          {:else if index === currentIndex}
            <Icon icon="material-symbols:pause" class="text-(--primary)" />
          {:else}
            <span class="text-sm text-(--content-meta)">{index + 1}</span>
          {/if}
        </div>
        <div
          class="w-10 h-10 rounded-lg overflow-hidden bg-(--btn-regular-bg) shrink-0"
        >
          <img
            src={getAssetPath(song.cover)}
            alt={song.title}
            loading="lazy"
            class="w-full h-full object-cover"
          />
        </div>
        <div class="flex-1 min-w-0">
          <div
            class="font-medium truncate"
            class:text-(--primary)={index === currentIndex}
            class:text-90={index !== currentIndex}
          >
            {song.title}
          </div>
          <div
            class="text-sm text-(--content-meta) truncate"
            class:text-(--primary)={index === currentIndex}
          >
            {song.artist}
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>
