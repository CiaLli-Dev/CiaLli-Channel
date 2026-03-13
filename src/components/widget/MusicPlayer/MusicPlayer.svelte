<script lang="ts">
  /* eslint-disable max-lines -- 文件行数较长，按页面驱动与模块边界保留当前结构 */
  import "../../../styles/music-player.css";
  import Icon from "@iconify/svelte";
  import { onDestroy, onMount, tick } from "svelte";
  import Key from "../../../i18n/i18nKey";
  import { i18n } from "../../../i18n/translation";
  import type { MusicPlayerConfig } from "../../../types/config";
  import {
    fetchPlaylistFromMeting,
    formatTime,
    getAssetPath,
    getNextSongIndex,
    calcBarPercent,
    clampRestoreTime,
    readDisplayMode,
    readPlaybackState,
    readVolumeSettings,
    resolveStoredPlaybackIndex,
    savePlaybackState,
    saveVolumeSettings,
    scheduleMarqueeResume,
    updateTitleMarquee,
  } from "../../../scripts/music-player-helpers";
  import type {
    PlayerDisplayMode,
    Song,
  } from "../../../scripts/music-player-helpers";
  import MusicPlayerPlaylist from "./MusicPlayerPlaylist.svelte";

  export let musicPlayer: MusicPlayerConfig = {
    enable: false,
    meting_api:
      "https://www.bilibili.uno/api?server=:server&type=:type&id=:id&auth=:auth&r=:r",
    id: "",
    server: "netease",
    type: "playlist",
    marqueeSpeed: 40,
  };

  const musicPlayerConfig = musicPlayer;

  let isPlaying = false,
    isExpanded = false,
    isHidden = false,
    showPlaylist = false;
  let currentTime = 0,
    duration = 0,
    volume = 0.7,
    isMuted = false,
    isLoading = false;
  let isShuffled = false,
    isRepeating = 0,
    errorMessage = "",
    showError = false;

  let currentSong: Song = {
    title: "Sample Song",
    artist: "Sample Artist",
    cover: "/favicon/favicon.ico",
    url: "",
    duration: 0,
    id: "",
  };

  let playlist: Song[] = [],
    currentIndex = 0;
  let audio: HTMLAudioElement, progressBar: HTMLElement, volumeBar: HTMLElement;
  let miniTitleWrap: HTMLDivElement | null = null,
    expandedTitleWrap: HTMLDivElement | null = null;
  let miniTitleMarquee = false,
    expandedTitleMarquee = false,
    marqueeRaf: number | null = null;
  let miniMarqueeDelay = false,
    expandedMarqueeDelay = false;
  let miniDelayTimer: number | null = null,
    expandedDelayTimer: number | null = null;
  const marqueeGap = 24,
    marqueePauseMs = 4000;
  const marqueeSpeed = Math.max(10, musicPlayerConfig.marqueeSpeed ?? 40);
  let pendingRestoreTime: number | null = null,
    persistTimer: number | null = null;
  let willAutoPlay = false,
    autoplayFailed = false,
    isVolumeDragging = false;
  let isPointerDown = false,
    volumeBarRect: DOMRect | null = null,
    rafId: number | null = null;

  async function fetchMetingPlaylist() {
    const api =
      musicPlayerConfig.meting_api ??
      "https://www.bilibili.uno/api?server=:server&type=:type&id=:id&auth=:auth&r=:r";
    const id = musicPlayerConfig.id ?? "14164869977";
    const server = musicPlayerConfig.server ?? "netease";
    const type = musicPlayerConfig.type ?? "playlist";
    if (!api || !id) return;
    isLoading = true;
    const songs = await fetchPlaylistFromMeting(api, server, type, id);
    if (songs === null) {
      showErrorMessage(i18n(Key.coreMusicPlayerErrorPlaylist));
      isLoading = false;
      return;
    }
    playlist = songs;
    if (playlist.length > 0) {
      const restored = applyPlaybackState();
      if (!restored) loadSong(playlist[0]);
    }
    isLoading = false;
  }

  function togglePlay() {
    if (!audio || !currentSong.url) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }
  function toggleExpanded() {
    isExpanded = !isExpanded;
    showPlaylist = false;
    if (isExpanded) isHidden = false;
  }
  function toggleHidden() {
    isHidden = !isHidden;
    if (isHidden) {
      isExpanded = false;
      showPlaylist = false;
    }
  }
  function togglePlaylist() {
    showPlaylist = !showPlaylist;
  }
  function toggleShuffle() {
    isShuffled = !isShuffled;
    if (isShuffled) isRepeating = 0;
  }
  function toggleRepeat() {
    isRepeating = (isRepeating + 1) % 3;
    if (isRepeating !== 0) isShuffled = false;
  }
  function toggleMute() {
    isMuted = !isMuted;
  }
  function hideError() {
    showError = false;
  }
  function showErrorMessage(msg: string) {
    errorMessage = msg;
    showError = true;
    setTimeout(() => {
      showError = false;
    }, 3000);
  }
  function persistPlaybackState() {
    savePlaybackState({
      index: currentIndex,
      songId: playlist[currentIndex]?.id,
      time: currentTime,
    });
  }
  function schedulePlaybackPersist() {
    if (persistTimer !== null) return;
    persistTimer = window.setTimeout(() => {
      persistPlaybackState();
      persistTimer = null;
    }, 1000);
  }
  function loadSong(song: typeof currentSong) {
    if (!song || song.url === currentSong.url) return;
    currentSong = { ...song };
    isLoading = Boolean(song.url);
  }
  function previousSong() {
    if (playlist.length <= 1) return;
    playSong(
      currentIndex > 0 ? currentIndex - 1 : playlist.length - 1,
      isPlaying,
    );
  }
  function nextSong(autoPlay?: boolean) {
    if (playlist.length <= 1) return;
    playSong(
      getNextSongIndex(currentIndex, playlist.length, isShuffled),
      autoPlay ?? isPlaying,
    );
  }
  function playSong(index: number, autoPlay = true) {
    if (index < 0 || index >= playlist.length) return;
    willAutoPlay = autoPlay;
    currentIndex = index;
    loadSong(playlist[currentIndex]);
    persistPlaybackState();
  }

  function applyDisplayMode(mode: PlayerDisplayMode): void {
    if (mode === "expanded") {
      isExpanded = true;
      isHidden = false;
      showPlaylist = false;
      return;
    }
    if (mode === "orb") {
      isHidden = true;
      isExpanded = false;
      showPlaylist = false;
      return;
    }
    isExpanded = false;
    isHidden = false;
    showPlaylist = false;
  }

  function applyPlaybackState(): boolean {
    const stored = readPlaybackState();
    if (!stored || playlist.length === 0) return false;
    const idx = resolveStoredPlaybackIndex(stored, playlist);
    if (idx < 0) return false;
    currentIndex = idx;
    willAutoPlay = false;
    loadSong(playlist[idx]);
    if (typeof stored.time === "number" && stored.time > 0)
      pendingRestoreTime = stored.time;
    return true;
  }

  function handleLoadSuccess() {
    isLoading = false;
    if (audio?.duration && audio.duration > 1) {
      duration = Math.floor(audio.duration);
      if (playlist[currentIndex]) playlist[currentIndex].duration = duration;
      currentSong.duration = duration;
    }
    if (pendingRestoreTime !== null && audio) {
      const t = clampRestoreTime(pendingRestoreTime, audio.duration);
      audio.currentTime = t;
      currentTime = t;
      pendingRestoreTime = null;
    }
    if (willAutoPlay || isPlaying) {
      audio.play().catch((e) => {
        console.warn("自动播放被拦截，等待用户交互:", e);
        autoplayFailed = true;
        isPlaying = false;
      });
    }
  }
  function handleUserInteraction() {
    if (autoplayFailed && audio) {
      audio
        .play()
        .then(() => {
          autoplayFailed = false;
        })
        .catch(() => {});
    }
  }
  function handleLoadError(_event: Event) {
    if (!currentSong.url) return;
    isLoading = false;
    showErrorMessage(i18n(Key.coreMusicPlayerErrorSong));
    const sc = isPlaying || willAutoPlay;
    if (playlist.length > 1) {
      setTimeout(() => nextSong(sc), 1000);
    } else {
      showErrorMessage(i18n(Key.coreMusicPlayerErrorEmpty));
    }
  }
  function handleAudioEnded() {
    if (isRepeating === 1) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else if (isRepeating === 2 || isShuffled) {
      nextSong(true);
    } else {
      isPlaying = false;
    }
    persistPlaybackState();
  }
  function setProgress(event: MouseEvent) {
    if (!audio || !progressBar) return;
    const newTime =
      calcBarPercent(event.clientX, progressBar.getBoundingClientRect()) *
      duration;
    audio.currentTime = newTime;
    currentTime = newTime;
    persistPlaybackState();
  }
  function startVolumeDrag(event: PointerEvent) {
    if (!volumeBar) return;
    event.preventDefault();
    isPointerDown = true;
    volumeBar.setPointerCapture(event.pointerId);
    volumeBarRect = volumeBar.getBoundingClientRect();
    volume = calcBarPercent(event.clientX, volumeBarRect);
  }
  function handleVolumeMove(event: PointerEvent) {
    if (!isPointerDown) return;
    event.preventDefault();
    isVolumeDragging = true;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      volume = calcBarPercent(
        event.clientX,
        volumeBarRect || volumeBar.getBoundingClientRect(),
      );
      rafId = null;
    });
  }
  function stopVolumeDrag(event: PointerEvent) {
    if (!isPointerDown) return;
    isPointerDown = false;
    isVolumeDragging = false;
    volumeBarRect = null;
    if (volumeBar) volumeBar.releasePointerCapture(event.pointerId);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    saveVolumeSettings(volume);
  }
  function clearMarqueeDelay(kind: "mini" | "expanded"): void {
    const isMini = kind === "mini";
    const timer = isMini ? miniDelayTimer : expandedDelayTimer;
    if (timer !== null) clearTimeout(timer);
    if (isMini) {
      miniDelayTimer = null;
      miniMarqueeDelay = false;
    } else {
      expandedDelayTimer = null;
      expandedMarqueeDelay = false;
    }
  }
  async function scheduleTitleMarqueeUpdate(): Promise<void> {
    if (typeof window === "undefined") return;
    await tick();
    if (marqueeRaf !== null) cancelAnimationFrame(marqueeRaf);
    marqueeRaf = window.requestAnimationFrame(() => {
      updateTitleMarquee(
        miniTitleWrap,
        (v) => {
          miniTitleMarquee = v;
        },
        marqueeSpeed,
        marqueeGap,
      );
      updateTitleMarquee(
        expandedTitleWrap,
        (v) => {
          expandedTitleMarquee = v;
        },
        marqueeSpeed,
        marqueeGap,
      );
      marqueeRaf = null;
    });
  }
  function handleMarqueeIteration(kind: "mini" | "expanded"): void {
    if (!isPlaying || typeof window === "undefined") return;
    clearMarqueeDelay(kind);
    const isMini = kind === "mini";
    if (!(isMini ? miniTitleMarquee : expandedTitleMarquee)) return;
    if (isMini) {
      miniMarqueeDelay = true;
      miniDelayTimer = scheduleMarqueeResume(marqueePauseMs, () => {
        miniMarqueeDelay = false;
        miniDelayTimer = null;
      });
    } else {
      expandedMarqueeDelay = true;
      expandedDelayTimer = scheduleMarqueeResume(marqueePauseMs, () => {
        expandedMarqueeDelay = false;
        expandedDelayTimer = null;
      });
    }
  }
  $: if (musicPlayerConfig.enable) {
    void currentSong.title;
    void isExpanded;
    void isHidden;
    void scheduleTitleMarqueeUpdate();
  }
  $: if (!isPlaying) {
    clearMarqueeDelay("mini");
    clearMarqueeDelay("expanded");
  }
  $: if (!miniTitleMarquee) clearMarqueeDelay("mini");
  $: if (!expandedTitleMarquee) clearMarqueeDelay("expanded");

  onMount(() => {
    const saved = readVolumeSettings();
    if (saved !== null) volume = saved;
    const evts = ["click", "keydown", "touchstart"] as const;
    evts.forEach((e) => {
      document.addEventListener(e, handleUserInteraction, { capture: true });
    });
    if (!musicPlayerConfig.enable) return;
    const storedMode = readDisplayMode();
    if (storedMode) applyDisplayMode(storedMode);
    fetchMetingPlaylist();
  });

  onDestroy(() => {
    if (typeof document !== "undefined") {
      (["click", "keydown", "touchstart"] as const).forEach((e) => {
        document.removeEventListener(e, handleUserInteraction, {
          capture: true,
        });
      });
    }
    if (marqueeRaf !== null) {
      cancelAnimationFrame(marqueeRaf);
      marqueeRaf = null;
    }
    clearMarqueeDelay("mini");
    clearMarqueeDelay("expanded");
  });
</script>

<audio
  bind:this={audio}
  src={getAssetPath(currentSong.url)}
  bind:volume
  bind:muted={isMuted}
  on:play={() => {
    isPlaying = true;
  }}
  on:pause={() => {
    isPlaying = false;
  }}
  on:timeupdate={() => {
    currentTime = audio.currentTime;
    schedulePlaybackPersist();
  }}
  on:ended={handleAudioEnded}
  on:error={handleLoadError}
  on:loadeddata={handleLoadSuccess}
  on:loadstart={() => {}}
  preload="auto"
></audio>

<svelte:window
  on:pointermove={handleVolumeMove}
  on:pointerup={stopVolumeDrag}
/>

{#if musicPlayerConfig.enable}
  {#if showError}
    <div class="fixed bottom-20 right-4 z-60 max-w-sm">
      <div
        class="bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-slide-up"
      >
        <Icon icon="material-symbols:error" class="text-xl shrink-0" />
        <span class="text-sm flex-1">{errorMessage}</span>
        <button
          on:click={hideError}
          class="text-white/80 hover:text-white transition-colors"
          aria-label="关闭提示"
        >
          <Icon icon="material-symbols:close" class="text-lg" />
        </button>
      </div>
    </div>
  {/if}

  <div
    class="music-player fixed bottom-4 right-4 z-50 transition-all duration-300 ease-in-out"
    class:expanded={isExpanded}
    class:hidden-mode={isHidden}
  >
    <!-- 隐藏状态的小圆球 -->
    <div
      class="orb-player w-12 h-12 bg-(--primary) rounded-full shadow-2xl cursor-pointer transition-all duration-500 ease-in-out flex items-center justify-center hover:scale-110 active:scale-95"
      hidden={!isHidden}
      class:opacity-0={!isHidden}
      class:scale-0={!isHidden}
      class:pointer-events-none={!isHidden}
      on:click={toggleHidden}
      on:keydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleHidden();
        }
      }}
      role="button"
      tabindex="0"
      aria-label={i18n(Key.coreMusicPlayerShow)}
    >
      {#if isLoading}
        <Icon icon="eos-icons:loading" class="text-white text-lg" />
      {:else if isPlaying}
        <div class="flex space-x-0.5">
          <div class="w-0.5 h-3 bg-white rounded-full animate-pulse"></div>
          <div
            class="w-0.5 h-4 bg-white rounded-full animate-pulse"
            style="animation-delay: 150ms;"
          ></div>
          <div
            class="w-0.5 h-2 bg-white rounded-full animate-pulse"
            style="animation-delay: 300ms;"
          ></div>
        </div>
      {:else}
        <Icon icon="material-symbols:music-note" class="text-white text-lg" />
      {/if}
    </div>

    <!-- 收缩状态的迷你播放器 -->
    <div
      class="mini-player card-base bg-(--float-panel-bg) shadow-2xl rounded-2xl p-3 transition-all duration-500 ease-in-out"
      hidden={isExpanded || isHidden}
      class:opacity-0={isExpanded || isHidden}
      class:scale-95={isExpanded || isHidden}
      class:pointer-events-none={isExpanded || isHidden}
    >
      <div class="flex items-center gap-3">
        <div
          class="cover-container relative w-12 h-12 rounded-lg overflow-hidden cursor-pointer"
          on:click={togglePlay}
          on:keydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              togglePlay();
            }
          }}
          role="button"
          tabindex="0"
          aria-label={isPlaying
            ? i18n(Key.coreMusicPlayerPause)
            : i18n(Key.coreMusicPlayerPlay)}
        >
          <img
            src={getAssetPath(currentSong.cover)}
            alt={i18n(Key.coreMusicPlayerCover)}
            class="w-full h-full object-cover transition-transform duration-300"
            class:animate-pulse={isLoading}
          />
          <div
            class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
          >
            {#if isLoading}
              <Icon icon="eos-icons:loading" class="text-white text-xl" />
            {:else if isPlaying}
              <Icon icon="material-symbols:pause" class="text-white text-xl" />
            {:else}
              <Icon
                icon="material-symbols:play-arrow"
                class="text-white text-xl"
              />
            {/if}
          </div>
        </div>
        <div
          class="flex-1 min-w-0 cursor-pointer"
          on:click={toggleExpanded}
          on:keydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleExpanded();
            }
          }}
          role="button"
          tabindex="0"
          aria-label={i18n(Key.coreMusicPlayerExpand)}
        >
          <div
            class="title-marquee text-sm font-medium text-90"
            bind:this={miniTitleWrap}
            class:marquee-active={miniTitleMarquee && isPlaying}
          >
            <div
              class="title-marquee__inner"
              class:marquee-delay={miniMarqueeDelay}
              on:animationiteration={() => handleMarqueeIteration("mini")}
            >
              <span class="title-marquee__text title-marquee__text--main"
                >{currentSong.title}</span
              >
              <span
                class="title-marquee__text title-marquee__clone"
                aria-hidden="true">{currentSong.title}</span
              >
            </div>
          </div>
          <div class="text-xs text-50 truncate">{currentSong.artist}</div>
        </div>
        <div class="flex items-center gap-1">
          <button
            class="btn-plain w-8 h-8 rounded-lg flex items-center justify-center"
            on:click|stopPropagation={toggleExpanded}
            aria-label={i18n(Key.coreMusicPlayerExpand)}
          >
            <Icon icon="material-symbols:expand-less" class="text-lg" />
          </button>
        </div>
      </div>
    </div>

    <!-- 展开状态的完整播放器 -->
    <div
      class="expanded-player transition-all duration-500 ease-in-out"
      hidden={!isExpanded || isHidden}
      class:opacity-0={!isExpanded}
      class:scale-95={!isExpanded}
      class:pointer-events-none={!isExpanded}
    >
      {#if showPlaylist}
        <MusicPlayerPlaylist
          {playlist}
          {currentIndex}
          {isPlaying}
          onClose={togglePlaylist}
          onPlay={playSong}
        />
      {/if}

      <div class="card-base bg-(--float-panel-bg) shadow-2xl rounded-2xl p-4">
        <div class="flex items-center gap-4 mb-4">
          <div
            class="cover-container relative w-16 h-16 rounded-lg overflow-hidden shrink-0"
          >
            <img
              src={getAssetPath(currentSong.cover)}
              alt={i18n(Key.coreMusicPlayerCover)}
              class="w-full h-full object-cover transition-transform duration-300"
              class:animate-pulse={isLoading}
            />
          </div>
          <div class="flex-1 min-w-0">
            <div
              class="song-title title-marquee text-lg font-bold text-90 mb-1"
              bind:this={expandedTitleWrap}
              class:marquee-active={expandedTitleMarquee && isPlaying}
            >
              <div
                class="title-marquee__inner"
                class:marquee-delay={expandedMarqueeDelay}
                on:animationiteration={() => handleMarqueeIteration("expanded")}
              >
                <span class="title-marquee__text title-marquee__text--main"
                  >{currentSong.title}</span
                >
                <span
                  class="title-marquee__text title-marquee__clone"
                  aria-hidden="true">{currentSong.title}</span
                >
              </div>
            </div>
            <div class="song-artist text-sm text-50 truncate">
              {currentSong.artist}
            </div>
            <div class="text-xs text-30 mt-1">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button
              class="btn-plain w-8 h-8 rounded-lg flex items-center justify-center"
              on:click={toggleExpanded}
              title={i18n(Key.coreMusicPlayerCollapse)}
            >
              <Icon icon="material-symbols:expand-more" class="text-lg" />
            </button>
          </div>
        </div>
        <div class="progress-section mb-4">
          <div
            class="progress-bar flex-1 h-2 bg-(--btn-regular-bg) rounded-full cursor-pointer"
            bind:this={progressBar}
            on:click={setProgress}
            on:keydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                const newTime = 0.5 * duration;
                if (audio) {
                  audio.currentTime = newTime;
                  currentTime = newTime;
                }
              }
            }}
            role="slider"
            tabindex="0"
            aria-label={i18n(Key.coreMusicPlayerProgress)}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={duration > 0 ? (currentTime / duration) * 100 : 0}
          >
            <div
              class="h-full bg-(--primary) rounded-full transition-all duration-100"
              style="width: {duration > 0
                ? (currentTime / duration) * 100
                : 0}%"
            ></div>
          </div>
        </div>
        <div class="controls flex items-center justify-center gap-2 mb-4">
          <button
            class="w-10 h-10 rounded-lg"
            class:btn-regular={isShuffled}
            class:btn-plain={!isShuffled}
            on:click={toggleShuffle}
            disabled={playlist.length <= 1}
            aria-label={i18n(Key.coreMusicPlayerShuffle)}
          >
            <Icon icon="material-symbols:shuffle" class="text-lg" />
          </button>
          <button
            class="btn-plain w-10 h-10 rounded-lg"
            on:click={previousSong}
            disabled={playlist.length <= 1}
            aria-label={i18n(Key.coreMusicPlayerPrevious)}
          >
            <Icon icon="material-symbols:skip-previous" class="text-xl" />
          </button>
          <button
            class="btn-regular w-12 h-12 rounded-full"
            class:opacity-50={isLoading}
            disabled={isLoading}
            on:click={togglePlay}
            aria-label={isPlaying
              ? i18n(Key.coreMusicPlayerPause)
              : i18n(Key.coreMusicPlayerPlay)}
          >
            {#if isLoading}
              <Icon icon="eos-icons:loading" class="text-xl" />
            {:else if isPlaying}
              <Icon icon="material-symbols:pause" class="text-xl" />
            {:else}
              <Icon icon="material-symbols:play-arrow" class="text-xl" />
            {/if}
          </button>
          <button
            class="btn-plain w-10 h-10 rounded-lg"
            on:click={() => nextSong()}
            disabled={playlist.length <= 1}
            aria-label={i18n(Key.coreMusicPlayerNext)}
          >
            <Icon icon="material-symbols:skip-next" class="text-xl" />
          </button>
          <button
            class="w-10 h-10 rounded-lg"
            class:btn-regular={isRepeating > 0}
            class:btn-plain={isRepeating === 0}
            on:click={toggleRepeat}
            aria-label={isRepeating === 1
              ? i18n(Key.coreMusicPlayerRepeatOne)
              : i18n(Key.coreMusicPlayerRepeat)}
          >
            {#if isRepeating === 1}
              <Icon icon="material-symbols:repeat-one" class="text-lg" />
            {:else if isRepeating === 2}
              <Icon icon="material-symbols:repeat" class="text-lg" />
            {:else}
              <Icon icon="material-symbols:repeat" class="text-lg opacity-50" />
            {/if}
          </button>
        </div>
        <div class="bottom-controls flex items-center gap-2">
          <button
            class="btn-plain w-8 h-8 rounded-lg"
            on:click={toggleMute}
            aria-label={i18n(Key.coreMusicPlayerVolume)}
          >
            {#if isMuted || volume === 0}
              <Icon icon="material-symbols:volume-off" class="text-lg" />
            {:else if volume < 0.5}
              <Icon icon="material-symbols:volume-down" class="text-lg" />
            {:else}
              <Icon icon="material-symbols:volume-up" class="text-lg" />
            {/if}
          </button>
          <div
            class="flex-1 h-2 bg-(--btn-regular-bg) rounded-full cursor-pointer touch-none"
            bind:this={volumeBar}
            on:pointerdown={startVolumeDrag}
            on:keydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (e.key === "Enter") toggleMute();
              }
            }}
            role="slider"
            tabindex="0"
            aria-label={i18n(Key.coreMusicPlayerVolume)}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={volume * 100}
          >
            <div
              class="h-full bg-(--primary) rounded-full transition-all"
              class:duration-100={!isVolumeDragging}
              class:duration-0={isVolumeDragging}
              style="width: {volume * 100}%"
            ></div>
          </div>
          <button
            class="btn-plain w-8 h-8 rounded-lg flex items-center justify-center"
            class:text-(--primary)={showPlaylist}
            on:click={togglePlaylist}
            title={i18n(Key.coreMusicPlayerPlaylist)}
            aria-label={i18n(Key.coreMusicPlayerPlaylist)}
          >
            <Icon icon="material-symbols:queue-music" class="text-lg" />
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
