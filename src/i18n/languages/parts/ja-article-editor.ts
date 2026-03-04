import Key from "../../i18nKey";

export const jaArticleEditor: Record<string, string> = {
    [Key.articleEditoredAt]: "公開日",
    [Key.articleEditorBodyEmptyCannotChangePasswordOnly]:
        "本文が空のまま、パスワードだけを変更することはできません",
    [Key.articleEditorBodyPlaceholder]: "ここに本文を入力してください...",
    [Key.articleEditorCoverCropTitle]: "カバー画像を切り抜き",
    [Key.articleEditorCoverUpdatedPendingSave]: "投稿カバー更新済み審査中保存",
    [Key.articleEditorDecryptUnsupported]:
        "現在の環境では復号に対応していません",
    [Key.articleEditorEditableContentNotFound]:
        "投稿編集可能本文が見つかりません",
    [Key.articleEditorEditorHintCreate]: "新しい記事の本文を入力してください",
    [Key.articleEditorEditorHintEdit]: "公開済みまたは下書きの記事を編集中です",
    [Key.articleEditorEditorTitleCreate]: "記事を作成",
    [Key.articleEditorEditorTitleEdit]: "記事を編集",
    [Key.articleEditorEncryptEnabledPasswordRequired]:
        "暗号化を有効にする場合はパスワードが必要です",
    [Key.articleEditorEncryptHintExisting]: "この投稿は暗号化が有効です",
    [Key.articleEditorEncryptHintLocked]:
        "暗号化コンテンツはロックされています",
    [Key.articleEditorEncryptUnsupported]:
        "現在の環境では暗号化に対応していません",
    [Key.articleEditorEncryptedAutoUnlockMissingPassword]:
        "暗号化コンテンツを検出しました。パスワードで解除してください",
    [Key.articleEditorEncryptedAutoUnlocked]:
        "暗号化コンテンツを自動で解除しました",
    [Key.articleEditorEncryptedBodyLockedPlaceholder]:
        "本文は暗号化されています。パスワード入力後に編集できます",
    [Key.articleEditorGeneratingEncryptedContent]:
        "暗号化コンテンツを生成しています...",
    [Key.articleEditorLoadFailed]: "読み込みに失敗しました",
    [Key.articleEditorLoadFailedRetry]:
        "読み込みに失敗しました。再試行してください",
    [Key.articleEditorLoginExpired]:
        "ログインの有効期限が切れました。再ログインしてください",
    [Key.articleEditorPasswordRequired]: "パスワードを入力してください",
    [Key.articleEditorPreviewFailedRetry]:
        "プレビューに失敗しました。再試行してください",
    [Key.articleEditorPreviewLoginRequired]: "プレビューにはログインが必要です",
    [Key.articleEditorPublished]: "公開しました",
    [Key.articleEditorRenderEncryptedFailed]:
        "暗号化コンテンツのレンダリングに失敗しました",
    [Key.articleEditorRenderInterruptedRetry]:
        "レンダリングが中断されました。再試行してください",
    [Key.articleEditorSaveCompleted]: "保存が完了しました",
    [Key.articleEditorSaveFailedRetry]:
        "保存に失敗しました。再試行してください",
    [Key.articleEditorSavingData]: "データを保存しています...",
    [Key.articleEditorSavingTitle]: "保存中",
    [Key.articleEditorTitleBodyRequired]: "タイトルと本文を入力してください",
    [Key.articleEditorTitleMaxLength]:
        "タイトルは {max} 文字以内で入力してください",
    [Key.articleEditorToolbarBoldPlaceholder]: "太字プレースホルダー",
    [Key.articleEditorToolbarCodeBlockPlaceholder]:
        "コードブロックプレースホルダー",
    [Key.articleEditorToolbarInlineCodePlaceholder]:
        "インラインコードプレースホルダー",
    [Key.articleEditorToolbarItalicPlaceholder]: "斜体プレースホルダー",
    [Key.articleEditorToolbarQuotePlaceholder]: "引用プレースホルダー",
    [Key.articleEditorToolbarStrikePlaceholder]: "取り消し線プレースホルダー",
    [Key.articleEditorToolbarUnderlinePlaceholder]: "下線プレースホルダー",
    [Key.articleEditorUploadFileFailed]:
        "ファイルのアップロードに失敗しました: {filename}",
    [Key.articleEditorUploadMissingFileId]:
        "アップロードは完了しましたがファイル ID がありません: {filename}",
    [Key.articleEditorUploadProgress]: "アップロード中（{current}/{total}）",
};
