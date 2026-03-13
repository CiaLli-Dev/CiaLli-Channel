<script lang="ts">
  export let username: string;
  export let editing: boolean;
  export let saving: boolean;
  export let saveMsg: string;
  export let mStatus: string;
  export let onStartEdit: () => void;
  export let onSave: () => void;
  export let onDelete: () => void;
</script>

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
        on:click={onStartEdit}
        class="px-4 h-9 rounded-lg text-sm font-medium transition cursor-pointer border border-(--line-divider) text-75 hover:bg-(--btn-plain-bg-hover)"
      >
        编辑相册
      </button>
    {:else}
      <button
        on:click={onSave}
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
        on:click={onDelete}
        class="px-4 h-9 rounded-lg text-sm font-medium transition cursor-pointer border border-red-400/60 text-red-500 hover:bg-red-500 hover:text-white"
      >
        删除相册
      </button>
    </div>
  {/if}
</div>
