import Key from "../../i18nKey";

export const jaInteraction: Record<string, string> = {
    [Key.interactionCommonSave]: "保存",
    [Key.interactionCommonConfirm]: "確認",
    [Key.interactionCommonCancel]: "キャンセル",
    [Key.interactionCommonDelete]: "削除",
    [Key.interactionCommonDeleteAdmin]: "削除（管理者）",
    [Key.interactionCommonEdit]: "編集",
    [Key.interactionCommonPreview]: "プレビュー",
    [Key.interactionCommonCreate]: "作成",
    [Key.interactionCommonCreateInProgress]: "作成中...",
    [Key.interactionCommonPublishNow]: "今すぐ公開",
    [Key.interactionCommonSaveChanges]: "変更を保存",
    [Key.interactionCommonUploadImage]: "画像をアップロード",
    [Key.interactionCommonAllowComments]: "コメントを許可",
    [Key.interactionCommonPublicVisible]: "公開する",
    [Key.interactionCommonImageOrder]: "画像の並び順",
    [Key.interactionCommonNoImages]:
        "画像はまだありません。アップロード後にここで並び替えできます。",
    [Key.interactionCommonBack]: "戻る",
    [Key.interactionCommonLoading]: "読み込み中...",
    [Key.interactionCommonProcessing]: "処理中...",
    [Key.interactionCommonSubmitting]: "送信中...",
    [Key.interactionCommonUploading]: "アップロード中...",
    [Key.interactionCommonRefresh]: "再読み込み",
    [Key.interactionCommonViewLink]: "リンクを見る",
    [Key.interactionCommonTitle]: "タイトル",
    [Key.interactionCommonDescription]: "説明",
    [Key.interactionCommonCategory]: "カテゴリ",
    [Key.interactionCommonClear]: "クリア",
    [Key.interactionCommonActionFailed]:
        "操作に失敗しました。しばらくしてから再試行してください。",
    [Key.interactionCommonActionSucceeded]: "操作に成功しました",
    [Key.interactionCommonActionSucceededReloading]:
        "操作に成功しました。再読み込みしています...",
    [Key.interactionCommonApplyCrop]: "切り抜きを適用",
    [Key.interactionCommonChooseFile]: "ファイルを選択",
    [Key.interactionCommonClose]: "閉じる",
    [Key.interactionCommonCropFailed]: "切り抜きに失敗しました",
    [Key.interactionCommonCropImage]: "画像を切り抜く",
    [Key.interactionCommonCropPreviewAlt]: "切り抜きプレビュー",
    [Key.interactionCommonDeleteFailed]: "削除に失敗しました",
    [Key.interactionCommonImageReadFailed]: "画像の読み込みに失敗しました",
    [Key.interactionCommonImageTooLarge]: "画像サイズが大きすぎます",
    [Key.interactionCommonImageUploadFailedRetry]:
        "画像のアップロードに失敗しました。再試行してください",
    [Key.interactionCommonImageUploading]: "画像をアップロード中...",
    [Key.interactionCommonLoaded]: "読み込み完了",
    [Key.interactionCommonNoChangesToSave]: "保存する変更はありません",
    [Key.interactionCommonUnsavedChangesLeaveConfirm]:
        "未保存の変更があります。ページを離れてもよろしいですか？",
    [Key.interactionCommonRequestFailed]:
        "リクエストに失敗しました。しばらくしてから再試行してください。",
    [Key.interactionCommonSaveCompleted]: "保存が完了しました",
    [Key.interactionCommonSaveCompletedReloading]:
        "保存が完了しました。再読み込みしています...",
    [Key.interactionCommonSaveFailed]: "保存に失敗しました",
    [Key.interactionCommonSaveFailedRetry]:
        "保存に失敗しました。再試行してください",
    [Key.interactionCommonSaveSuccess]: "保存しました",
    [Key.interactionCommonSaved]: "保存済み",
    [Key.interactionCommonSavedReloading]: "保存済み。再読み込みしています...",
    [Key.interactionCommonSaving]: "保存中...",
    [Key.interactionCommonSelectImage]: "画像を選択",
    [Key.interactionCommonSelectImageFirst]: "先に画像を選択してください",
    [Key.interactionCommonZoom]: "ズーム",
    [Key.interactionDialogAuthRequiredTitle]: "ログインが必要です",
    [Key.interactionDialogAuthRequiredMessage]:
        "この機能を使うにはログインが必要です。",
    [Key.interactionDialogGoLogin]: "ログインへ",
    [Key.interactionDialogConfirmTitle]: "操作の確認",
    [Key.interactionDialogNoticeTitle]: "お知らせ",
    [Key.interactionDialogFormTitle]: "情報入力",
    [Key.interactionDialogAcknowledge]: "了解",
    [Key.interactionDialogManualConfirmLabel]: "「",
    [Key.interactionDialogManualConfirmSuffix]: "」と入力して削除を確認",
    [Key.interactionDialogManualConfirmMismatch]:
        "入力内容が一致しません。「{text}」を入力してください",
    [Key.interactionApiIllegalOrigin]: "不正な送信元リクエストです",
    [Key.interactionApiRateLimitServiceMissing]:
        "ログインのレート制限サービスが設定されていません",
    [Key.interactionApiRateLimitCheckFailed]: "レート制限の確認に失敗しました",
    [Key.interactionApiInvalidJsonBody]:
        "リクエスト本文が正しい JSON ではありません",
    [Key.interactionApiAuthEmailPasswordRequired]:
        "メールアドレスとパスワードを入力してください",
    [Key.interactionApiAuthInvalidCredentials]:
        "メールアドレスまたはパスワードが正しくありません",
    [Key.interactionApiAuthLoginFailed]: "ログインに失敗しました",
    [Key.interactionApiAuthNotLoggedIn]: "ログインしていません",
    [Key.interactionApiAuthGetUserFailed]: "ユーザー情報の取得に失敗しました",
    [Key.interactionApiServerConfigMissing]:
        "サーバー設定が不足しています。管理者に連絡してください。",
    [Key.interactionPostNoPermissionDeleteArticle]:
        "この投稿を削除する権限がありません。",
    [Key.interactionPostNoPermissionDeleteDiary]:
        "この日記を削除する権限がありません。",
    [Key.interactionPostDeleteConfirmAdminArticle]:
        "管理者としてこの記事を削除しますか？削除後は元に戻せません。",
    [Key.interactionPostDeleteConfirmOwnArticle]:
        "この記事を削除しますか？削除後は元に戻せません。",
    [Key.interactionPostDeleteConfirmAdminDiary]:
        "管理者としてこの日記を削除しますか？削除後は元に戻せません。",
    [Key.interactionPostDeleteConfirmOwnDiary]:
        "この日記を削除しますか？削除後は元に戻せません。",
    [Key.interactionPostDeleteFailed]:
        "削除に失敗しました。後ほど再試行してください。",
    [Key.interactionPostCannotBlockUser]: "このユーザーをブロックできません。",
    [Key.interactionPostBlockUserTitle]: "ユーザーをブロック",
    [Key.interactionPostBlockUserMessage]:
        "必要であれば理由を入力してください。確認後、このユーザーの内容は非表示になります。",
    [Key.interactionPostBlockReasonLabel]: "ブロック理由（任意）",
    [Key.interactionPostBlockReasonPlaceholder]: "例: スパム投稿、嫌がらせなど",
    [Key.interactionPostBlockSuccess]: "ユーザーをブロックしました。",
    [Key.interactionPostActionFailed]:
        "操作に失敗しました。後ほどもう一度お試しください。",
};
