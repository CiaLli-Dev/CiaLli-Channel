<script lang="ts">
  import Icon from "@iconify/svelte";
  import { onDestroy } from "svelte";

  import I18nKey from "../../i18n/i18nKey";
  import { i18n } from "../../i18n/translation";
  import {
    copyTextToClipboard,
    downloadSharePosterImage,
    generateSharePosterImage,
    resolveShareThemeColor,
    type SharePosterPayload,
  } from "@utils/share-poster";

  export let title: string;
  export let author: string;
  export let description = "";
  export let pubDate: string;
  export let coverImage: string | null = null;
  export let url: string;
  export let siteTitle: string;
  export let avatar: string | null = null;

  let showModal = false;
  let posterImage = "";
  let themeColor = "#558e88";
  let copied = false;
  let feedbackTimer = 0;

  function buildPayload(): SharePosterPayload {
    return {
      title,
      author,
      description,
      pubDate,
      coverImage,
      url,
      siteTitle,
      avatar,
    };
  }

  async function generatePoster(): Promise<void> {
    showModal = true;
    if (posterImage) {
      return;
    }

    try {
      themeColor = resolveShareThemeColor();
      posterImage = await generateSharePosterImage(buildPayload(), {
        themeColor,
        authorLabel: i18n(I18nKey.author),
        scanLabel: i18n(I18nKey.contentScanToRead),
      });
    } catch (error) {
      console.error("Failed to generate poster:", error);
    }
  }

  async function copyLink(): Promise<void> {
    try {
      await copyTextToClipboard(url);
      copied = true;
      if (feedbackTimer) {
        window.clearTimeout(feedbackTimer);
      }
      feedbackTimer = window.setTimeout(() => {
        copied = false;
      }, 2000);
    } catch (error) {
      console.error("Failed to copy link:", error);
    }
  }

  function downloadPoster(): void {
    if (!posterImage) {
      return;
    }
    downloadSharePosterImage(posterImage, title || siteTitle);
  }

  function closeModal(): void {
    showModal = false;
  }

  function onBackdropKeydown(event: KeyboardEvent): void {
    if (
      event.key === "Enter" ||
      event.key === " " ||
      event.key === "Spacebar" ||
      event.key === "Escape"
    ) {
      event.preventDefault();
      closeModal();
    }
  }

  function portal(node: HTMLElement): { destroy: () => void } {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      },
    };
  }

  onDestroy(() => {
    if (feedbackTimer) {
      window.clearTimeout(feedbackTimer);
    }
  });
</script>

<button
  class="btn-regular px-6 py-3 rounded-lg inline-flex items-center gap-2"
  on:click={generatePoster}
  aria-label="Generate Share Poster"
>
  <span>{i18n(I18nKey.contentShareArticle)}</span>
</button>

{#if showModal}
  <div
    use:portal
    class="fixed inset-0 z-9999 flex items-center justify-center bg-black/60 p-4 transition-opacity"
    role="button"
    tabindex="0"
    aria-label="Close poster modal"
    on:click|self={closeModal}
    on:keydown={onBackdropKeydown}
  >
    <div
      class="bg-white dark:bg-gray-800 rounded-2xl max-w-sm w-full max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl transform transition-all"
    >
      <div
        class="p-6 flex justify-center bg-gray-50 dark:bg-gray-900 min-h-[200px] items-center"
      >
        {#if posterImage}
          <img
            src={posterImage}
            alt="Poster"
            class="max-w-full h-auto shadow-lg rounded-lg"
          />
        {:else}
          <div class="flex flex-col items-center gap-3">
            <div
              class="w-8 h-8 border-2 border-gray-200 rounded-full animate-spin"
              style="border-top-color: {themeColor}"
            ></div>
            <span class="text-sm text-gray-500 dark:text-gray-400"
              >{i18n(I18nKey.contentGeneratingPoster)}</span
            >
          </div>
        {/if}
      </div>

      <div
        class="p-4 border-t border-gray-100 dark:border-gray-700 grid grid-cols-2 gap-3"
      >
        <button
          class="py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          on:click={copyLink}
        >
          {#if copied}
            <Icon icon="material-symbols:check" width="20" height="20" />
            <span>{i18n(I18nKey.contentCopied)}</span>
          {:else}
            <Icon icon="material-symbols:link" width="20" height="20" />
            <span>{i18n(I18nKey.contentCopyLink)}</span>
          {/if}
        </button>
        <button
          class="py-3 text-white rounded-xl font-medium active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-90"
          style="background-color: {themeColor};"
          on:click={downloadPoster}
          disabled={!posterImage}
        >
          <Icon icon="material-symbols:download" width="20" height="20" />
          {i18n(I18nKey.contentSavePoster)}
        </button>
      </div>
    </div>
  </div>
{/if}
