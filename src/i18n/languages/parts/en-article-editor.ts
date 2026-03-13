import Key from "../../i18nKey";

export const enArticleEditor: Record<string, string> = {
    [Key.articleEditoredAt]: "Published at",
    [Key.articleEditorBodyEmptyCannotChangePasswordOnly]:
        "Cannot change password only when body is empty",
    [Key.articleEditorBodyPlaceholder]: "Enter article content here...",
    [Key.articleEditorCoverCropTitle]: "Crop cover",
    [Key.articleEditorCoverUpdatedPendingSave]:
        "Cover updated. Changes take effect after saving",
    [Key.articleEditorDecryptUnsupported]:
        "Decryption is not supported in the current environment",
    [Key.articleEditorEditableContentNotFound]: "Editable content not found",
    [Key.articleEditorEditorHintCreate]: "Write your new article content",
    [Key.articleEditorEditorHintEdit]:
        "You are editing published or draft content",
    [Key.articleEditorEditorTitleCreate]: "Create Article",
    [Key.articleEditorEditorTitleEdit]: "Edit Article",
    [Key.articleEditorEncryptEnabledPasswordRequired]:
        "Password is required when encryption is enabled",
    [Key.articleEditorEncryptHintExisting]:
        "Encryption is enabled for this article",
    [Key.articleEditorEncryptHintLocked]: "Encrypted content is locked",
    [Key.articleEditorEncryptUnsupported]:
        "Encryption is not supported in the current environment",
    [Key.articleEditorEncryptedAutoUnlockMissingPassword]:
        "Encrypted content detected. Enter password to unlock",
    [Key.articleEditorEncryptedAutoUnlocked]:
        "Encrypted content unlocked automatically",
    [Key.articleEditorEncryptedBodyLockedPlaceholder]:
        "Content is encrypted. Enter password to edit",
    [Key.articleEditorGeneratingEncryptedContent]:
        "Generating encrypted content...",
    [Key.articleEditorLoadFailed]: "Failed to load",
    [Key.articleEditorLoadFailedRetry]: "Load failed. Please try again",
    [Key.articleEditorLocalDraftRestored]:
        "Restored your current working draft",
    [Key.articleEditorLocalDraftSaved]: "Working draft saved",
    [Key.articleEditorLoginExpired]: "Login expired. Please log in again",
    [Key.articleEditorPasswordRequired]: "Please enter password",
    [Key.articleEditorPreviewFailedRetry]: "Preview failed. Please try again",
    [Key.articleEditorPreviewLoginRequired]: "Please log in before previewing",
    [Key.articleEditorPublished]: "Published successfully",
    [Key.articleEditorRenderEncryptedFailed]:
        "Failed to render encrypted content",
    [Key.articleEditorRenderInterruptedRetry]:
        "Rendering interrupted. Please try again",
    [Key.articleEditorSaveCompleted]: "Saved",
    [Key.articleEditorSaveFailedRetry]: "Save failed. Please try again",
    [Key.articleEditorSavingData]: "Saving data...",
    [Key.articleEditorSavingTitle]: "Saving",
    [Key.articleEditorTitleBodyRequired]: "Please enter title and content",
    [Key.articleEditorTitleMaxLength]:
        "Title must be no longer than {max} characters",
    [Key.articleEditorToolbarBoldPlaceholder]: "Enter bold text",
    [Key.articleEditorToolbarCodeBlockPlaceholder]: "Enter code block content",
    [Key.articleEditorToolbarInlineCodePlaceholder]:
        "Enter inline code content",
    [Key.articleEditorToolbarItalicPlaceholder]: "Enter italic text",
    [Key.articleEditorToolbarQuotePlaceholder]: "Enter quote text",
    [Key.articleEditorToolbarStrikePlaceholder]: "Enter strikethrough text",
    [Key.articleEditorToolbarUnderlinePlaceholder]: "Enter underlined text",
    [Key.articleEditorUploadFileFailed]: "Failed to upload file: {filename}",
    [Key.articleEditorUploadMissingFileId]:
        "Upload succeeded but file ID is missing: {filename}",
    [Key.articleEditorUploadProgress]: "Uploading ({current}/{total})",
};
