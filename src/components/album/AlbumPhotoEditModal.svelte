<script lang="ts">
  export let editPhotoTitle: string;
  export let editPhotoDesc: string;
  export let onSave: () => void;
  export let onCancel: () => void;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
  on:click|self={onCancel}
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
        on:click={onCancel}
        class="px-4 h-9 rounded-lg text-sm border border-(--line-divider) text-75 hover:bg-(--btn-plain-bg-hover) transition cursor-pointer"
        >取消</button
      >
      <button
        on:click={onSave}
        class="px-4 h-9 rounded-lg text-sm bg-(--primary) text-white hover:opacity-90 transition cursor-pointer"
        >保存</button
      >
    </div>
  </div>
</div>
