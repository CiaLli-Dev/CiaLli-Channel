/**
 * 注册页面国际化辅助 — 服务端构建 i18n 对象与状态元信息
 */

import type { RegistrationRequestStatus } from "@/types/app";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";

export type RegistrationStatusMeta = {
    label: string;
    description: string;
    tone: "warning" | "success" | "danger" | "neutral";
};

export function buildRegistrationStatusMeta(): Record<
    RegistrationRequestStatus,
    RegistrationStatusMeta
> {
    return {
        pending: {
            label: i18n(I18nKey.authRegisterStatusPending),
            description: i18n(I18nKey.authRegisterStatusPendingDesc),
            tone: "warning",
        },
        approved: {
            label: i18n(I18nKey.authRegisterStatusApproved),
            description: i18n(I18nKey.authRegisterStatusApprovedDesc),
            tone: "success",
        },
        rejected: {
            label: i18n(I18nKey.authRegisterStatusRejected),
            description: i18n(I18nKey.authRegisterStatusRejectedDesc),
            tone: "danger",
        },
        cancelled: {
            label: i18n(I18nKey.authRegisterStatusCancelled),
            description: i18n(I18nKey.authRegisterStatusCancelledDesc),
            tone: "neutral",
        },
    };
}

export function buildRegisterI18n(): Record<string, string> {
    return {
        registerDisabled: i18n(I18nKey.authRegisterDisabled),
        emailExists: i18n(I18nKey.authRegisterEmailExists),
        usernameExists: i18n(I18nKey.authRegisterUsernameExists),
        requestExists: i18n(I18nKey.authRegisterRequestExists),
        statusConflict: i18n(I18nKey.authRegisterStatusConflict),
        requestForbidden: i18n(I18nKey.authRegisterRequestForbidden),
        passwordRequired: i18n(I18nKey.authRegisterPasswordRequired),
        passwordInvalid: i18n(I18nKey.authRegisterPasswordInvalid),
        passwordTooShort: i18n(I18nKey.authRegisterPasswordTooShort),
        passwordTooLong: i18n(I18nKey.authRegisterPasswordTooLong),
        submitFailed: i18n(I18nKey.authRegisterSubmitFailed),
        emailRequired: i18n(I18nKey.authRegisterEmailRequired),
        emailInvalid: i18n(I18nKey.authRegisterEmailInvalid),
        checking: i18n(I18nKey.authRegisterChecking),
        emailAvailable: i18n(I18nKey.authRegisterEmailAvailable),
        emailUnavailable: i18n(I18nKey.authRegisterEmailUnavailable),
        emailCheckFailed: i18n(I18nKey.authRegisterEmailCheckFailed),
        usernameRequired: i18n(I18nKey.authRegisterUsernameRequired),
        usernameRule: i18n(I18nKey.authRegisterUsernameRule),
        usernameTooLong: i18n(I18nKey.authRegisterUsernameTooLong),
        usernameAvailable: i18n(I18nKey.authRegisterUsernameAvailable),
        usernameUnavailable: i18n(I18nKey.authRegisterUsernameUnavailable),
        usernameCheckFailed: i18n(I18nKey.authRegisterUsernameCheckFailed),
        hidePassword: i18n(I18nKey.authHidePassword),
        showPassword: i18n(I18nKey.authShowPassword),
        passwordEmpty: i18n(I18nKey.authRegisterPasswordEmpty),
        passwordSetHint: i18n(I18nKey.authRegisterPasswordSetHint),
        passwordLengthValid: i18n(I18nKey.authRegisterPasswordLengthValid),
        reapplyDraftLoaded: i18n(I18nKey.authRegisterReapplyDraftLoaded),
        cropUploading: i18n(I18nKey.authRegisterCropUploading),
        cropApply: i18n(I18nKey.interactionCommonApplyCrop),
        selectImage: i18n(I18nKey.authRegisterSelectImage),
        avatarTooLarge: i18n(I18nKey.authRegisterAvatarTooLarge),
        imageReadFailed: i18n(I18nKey.interactionCommonImageReadFailed),
        cropFailedRetry: i18n(I18nKey.interactionCommonCropFailed),
        avatarUploadFailed: i18n(I18nKey.authRegisterAvatarUploadFailed),
        completeForm: i18n(I18nKey.authRegisterCompleteForm),
        passwordRangeInvalid: i18n(I18nKey.authRegisterPasswordRangeInvalid),
        fixPasswordFirst: i18n(I18nKey.authRegisterFixPasswordFirst),
        fixAccountFieldFirst: i18n(I18nKey.authRegisterFixAccountFirst),
        submitting: i18n(I18nKey.interactionCommonSubmitting),
        submitButtonText: i18n(I18nKey.authRegisterSubmit),
        submitOverlayTitle: i18n(I18nKey.authRegisterSubmittingTitle),
        submitOverlayText: i18n(I18nKey.authRegisterSubmittingText),
        uploadAvatarButtonText: i18n(I18nKey.authRegisterUploadingAvatar),
        uploadAvatarOverlayText: i18n(I18nKey.authRegisterUploadingAvatarText),
        submitRequestOverlayText: i18n(
            I18nKey.authRegisterSubmittingRequestText,
        ),
        submitSuccessRedirecting: i18n(
            I18nKey.authRegisterSubmitSuccessRedirecting,
        ),
        submitFailedRetry: i18n(I18nKey.authRegisterSubmitFailedRetry),
        reapplyButtonText: i18n(I18nKey.authRegisterReapply),
        processing: i18n(I18nKey.interactionCommonProcessing),
        resetStatusTitle: i18n(I18nKey.authRegisterResetStatusTitle),
        processedRedirecting: i18n(I18nKey.authRegisterProcessedRedirecting),
        resetFailed: i18n(I18nKey.authRegisterResetFailed),
        cancelRequestButtonText: i18n(I18nKey.authRegisterCancelRequest),
        invalidRequestId: i18n(I18nKey.authRegisterInvalidRequestId),
        confirmCancelRequest: i18n(I18nKey.authRegisterConfirmCancelRequest),
        confirmCancelText: i18n(I18nKey.authRegisterConfirmCancelText),
        cancelThinkAgain: i18n(I18nKey.authRegisterCancelThinkAgain),
        cancelOverlayTitle: i18n(I18nKey.authRegisterCancellingTitle),
        cancelSuccessRefreshing: i18n(
            I18nKey.authRegisterCancelSuccessRefreshing,
        ),
        cancelFailed: i18n(I18nKey.authRegisterCancelFailed),
    };
}
