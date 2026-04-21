import Key from "../../../i18nKey";

export const enInteraction: Record<string, string> = {
    [Key.interactionCommonSave]: "Save",
    [Key.interactionCommonConfirm]: "Confirm",
    [Key.interactionCommonCancel]: "Cancel",
    [Key.interactionCommonDelete]: "Delete",
    [Key.interactionCommonDeleteAdmin]: "Delete (Admin)",
    [Key.interactionCommonEdit]: "Edit",
    [Key.interactionCommonPreview]: "Preview",
    [Key.interactionCommonCreate]: "Create",
    [Key.interactionCommonCreateInProgress]: "Creating...",
    [Key.interactionCommonPublishNow]: "Publish Now",
    [Key.interactionCommonSaveChanges]: "Save Changes",
    [Key.interactionCommonSaveDraft]: "Save Draft",
    [Key.interactionCommonDiscardDraft]: "Discard Draft",
    [Key.interactionCommonUploadImage]: "Upload Image",
    [Key.interactionCommonAllowComments]: "Allow Comments",
    [Key.interactionCommonPublicVisible]: "Publicly Visible",
    [Key.interactionCommonImageOrder]: "Image Order",
    [Key.interactionCommonNoImages]:
        "No images yet. Upload images to reorder here.",
    [Key.interactionCommonBack]: "Back",
    [Key.interactionCommonLoading]: "Loading...",
    [Key.interactionCommonProcessing]: "Processing...",
    [Key.interactionCommonSubmitting]: "Submitting...",
    [Key.interactionCommonUploading]: "Uploading...",
    [Key.interactionCommonRefresh]: "Refresh",
    [Key.interactionCommonViewLink]: "View Link",
    [Key.interactionCommonTitle]: "Title",
    [Key.interactionCommonDescription]: "Description",
    [Key.interactionCommonCategory]: "Category",
    [Key.interactionCommonClear]: "Clear",
    [Key.interactionCommonActionFailed]:
        "Operation failed. Please try again later.",
    [Key.interactionCommonActionSucceeded]: "Operation succeeded",
    [Key.interactionCommonActionSucceededReloading]:
        "Operation succeeded. Refreshing...",
    [Key.interactionCommonApplyCrop]: "Apply crop",
    [Key.interactionCommonChooseFile]: "Choose file",
    [Key.interactionCommonClose]: "Close",
    [Key.interactionCommonCropFailed]: "Crop failed",
    [Key.interactionCommonCropImage]: "Crop image",
    [Key.interactionCommonCropPreviewAlt]: "Crop preview",
    [Key.interactionCommonDeleteFailed]: "Delete failed",
    [Key.interactionCommonImageReadFailed]: "Failed to read image",
    [Key.interactionCommonImageTooLarge]: "Image is too large",
    [Key.interactionCommonImageUploadFailedRetry]:
        "Image upload failed. Please try again",
    [Key.interactionCommonImageUploading]: "Uploading image...",
    [Key.interactionCommonLoaded]: "Loaded",
    [Key.interactionCommonNoChangesToSave]: "No changes to save",
    [Key.interactionCommonUnsavedChangesLeaveConfirm]:
        "You have unsaved changes. Leave this page anyway?",
    [Key.interactionCommonRequestFailed]:
        "Request failed. Please try again later.",
    [Key.interactionCommonSaveCompleted]: "Saved",
    [Key.interactionCommonSaveCompletedReloading]: "Saved. Refreshing...",
    [Key.interactionCommonSaveFailed]: "Save failed",
    [Key.interactionCommonSaveFailedRetry]: "Save failed. Please try again",
    [Key.interactionCommonSaveSuccess]: "Saved successfully",
    [Key.interactionCommonSaved]: "Saved",
    [Key.interactionCommonSavedReloading]: "Saved. Refreshing...",
    [Key.interactionCommonSaving]: "Saving...",
    [Key.interactionCommonSelectImage]: "Select image",
    [Key.interactionCommonSelectImageFirst]: "Please select an image first",
    [Key.interactionCommonZoom]: "Zoom",
    [Key.interactionCommonZoomIn]: "Zoom in",
    [Key.interactionCommonZoomOut]: "Zoom out",
    [Key.interactionCommonReset]: "Reset",
    [Key.interactionArticleAiSummaryTitle]: "AI Summary",
    [Key.interactionArticleAiSummaryGenerating]: "Generating",
    [Key.interactionArticleAiSummaryQueued]: "Queued",
    [Key.interactionArticleAiSummaryFailed]: "Failed",
    [Key.interactionArticleAiSummaryGeneratingHint]:
        "AI is generating the summary...",
    [Key.interactionArticleAiSummaryQueuedHint]:
        "The AI summary job has been created and is waiting to be processed...",
    [Key.interactionArticleAiSummaryFailedHint]:
        "The AI summary is temporarily unavailable. Please refresh and try again later.",
    [Key.interactionDialogAuthRequiredTitle]: "Login required",
    [Key.interactionDialogAuthRequiredMessage]:
        "You need to log in before using this feature.",
    [Key.interactionDialogGoLogin]: "Go to login",
    [Key.interactionDialogConfirmTitle]: "Confirm Action",
    [Key.interactionDialogNoticeTitle]: "Notice",
    [Key.interactionDialogFormTitle]: "Fill in Information",
    [Key.interactionDialogUnsavedChangesTitle]: "Unsaved Changes",
    [Key.interactionDialogUnsavedChangesMessage]:
        "This draft has unsaved changes. You can save before leaving, or leave now and discard the current edits.",
    [Key.interactionDialogUnsavedChangesSaveAndLeave]: "Save and Leave",
    [Key.interactionDialogUnsavedChangesDiscardAndLeave]:
        "Leave Without Saving",
    [Key.interactionDialogAcknowledge]: "Got it",
    [Key.interactionDialogManualConfirmLabel]: 'Type "',
    [Key.interactionDialogManualConfirmSuffix]: '" to confirm deletion',
    [Key.interactionDialogManualConfirmMismatch]:
        'Input does not match. Please type "{text}"',
    [Key.interactionApiIllegalOrigin]: "Invalid request origin",
    [Key.interactionApiRateLimitServiceMissing]:
        "Login rate limit service is not configured",
    [Key.interactionApiRateLimitCheckFailed]: "Rate limit check failed",
    [Key.interactionApiInvalidJsonBody]: "Request body is not valid JSON",
    [Key.interactionApiAuthEmailPasswordRequired]:
        "Please provide both email and password",
    [Key.interactionApiAuthInvalidCredentials]: "Invalid email or password",
    [Key.interactionApiAuthLoginFailed]: "Login failed",
    [Key.interactionApiAuthNotLoggedIn]: "Not logged in",
    [Key.interactionApiAuthGetUserFailed]: "Failed to fetch user info",
    [Key.interactionApiServerConfigMissing]:
        "Server configuration is missing. Please contact the administrator.",
    [Key.interactionPostNoPermissionDeleteArticle]:
        "You do not have permission to delete this article.",
    [Key.interactionPostNoPermissionDeleteDiary]:
        "You do not have permission to delete this diary.",
    [Key.interactionPostDeleteConfirmAdminArticle]:
        "Delete this article as an admin? This action cannot be undone.",
    [Key.interactionPostDeleteConfirmOwnArticle]:
        "Delete this article? This action cannot be undone.",
    [Key.interactionPostDeleteConfirmAdminDiary]:
        "Delete this diary as an admin? This action cannot be undone.",
    [Key.interactionPostDeleteConfirmOwnDiary]:
        "Delete this diary? This action cannot be undone.",
    [Key.interactionPostDeleteFailed]: "Delete failed. Please try again later.",
    [Key.interactionPostActionFailed]:
        "Operation failed. Please try again later.",
};
