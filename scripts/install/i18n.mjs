export const DEFAULT_INSTALL_LANGUAGE = "zh_CN";

export const INSTALL_LANGUAGES = ["en", "zh_CN", "zh_TW", "ja"];

export const INSTALL_LANGUAGE_LABELS = {
    en: "English",
    zh_CN: "简体中文",
    zh_TW: "繁體中文",
    ja: "日本語",
};

const LANGUAGE_ALIASES = {
    en: "en",
    "en-us": "en",
    en_us: "en",
    "en-gb": "en",
    en_gb: "en",
    zh_cn: "zh_CN",
    "zh-cn": "zh_CN",
    zh_tw: "zh_TW",
    "zh-tw": "zh_TW",
    ja: "ja",
    "ja-jp": "ja",
    ja_jp: "ja",
};

const MESSAGES = {
    en: {
        unknownCommand: "Unknown command: {command}",
        unknownArgument: "Unknown argument: {token}",
        missingArgumentValue: "Missing value for {option}",
        invalidLanguage:
            "Unsupported language: {lang}. Supported values: {supported}",
        unknownInstallError: "Unknown install error",
        installFailed: "[install] Failed: {message}",
        selectLanguage:
            "Select installer language [1-4 or code] (1. English / 2. 简体中文 / 3. 繁體中文 / 4. 日本語): ",
        selectLanguageRetry:
            "Invalid language choice. Enter 1-4 or one of: {supported}.",
        promptSiteUrl:
            "Public site root URL (for example https://example.com): ",
        unsupportedPlatform:
            "Unsupported host platform: {platform}. Only Linux / macOS / WSL are supported.",
        resetCleanup:
            "[install] --reset detected. Cleaning existing Compose resources.",
        buildImages: "[install] Building web / worker images.",
        startInfra:
            "[install] Starting infrastructure, seed restore jobs, and Directus.",
        provisionStorage:
            "[install] Provisioning the MinIO service account used by Directus storage.",
        createRole: "[install] Creating Directus administrator role.",
        createAdminUser: "[install] Creating Directus administrator user.",
        generateStaticToken:
            "[install] Logging into Directus and generating server static token.",
        updateSiteLanguage:
            "[install] Writing the selected site default language into Directus.",
        startApp: "[install] Starting web / worker / proxy.",
        installComplete: "[install] Installation completed.",
        configSummaryTitle: "[install] Generated configuration summary:",
        envFileWritten: "[install] .env written to: {path}",
        envViewHint:
            "[install] All generated values are shown above and persisted in .env for later review or backup.",
        siteEntry: "[install] Site entry: {url}",
        directusEntry: "[install] Directus: {url}",
        unsupportedSiteUrl:
            "The site URL is invalid. Use an http(s) root URL without path, query, or hash: {siteUrl}",
        siteUrlRequired:
            "The installer requires the public site URL. Provide it interactively or via --site-url.",
        projectRootNotFound:
            "Project root not found. Run the installer inside the repository directory that contains package.json and docker-compose.yml.",
        dockerDaemonUnavailable:
            "Docker daemon is unavailable. On macOS / WSL start Docker Desktop; on Linux ensure the docker service is running.",
        portUnavailable: "Host port is unavailable: {label} {host}:{port}",
        existingInstallDetected:
            "Existing deployment detected, refusing to continue: {reasons}. Pass --reset to reinstall.",
        roleIdMissing:
            "Failed to resolve the Directus administrator role ID created by the installer.",
        directusAdminLoginFailed:
            "Directus administrator login failed: HTTP {status}",
        directusAccessTokenMissing:
            "Directus login succeeded, but no access token was returned.",
        directusReadAdminFailed:
            "Failed to read administrator account information: HTTP {status}",
        directusAdminUserIdMissing: "Directus administrator user ID is empty.",
        directusStaticTokenPersistFailed:
            "Failed to persist Directus static token: HTTP {status}",
        waitForHealthTimeout:
            "Timed out while waiting for service health check: {url}",
        siteLanguageReadFailed:
            "Failed to read current site settings before applying the selected language: HTTP {status}",
        siteLanguageWriteFailed:
            "Failed to persist the selected site language: HTTP {status}",
        composeContainerDetected: "Compose containers found",
        composeVolumesDetected: "Compose volumes found",
        envFileDetected: "Existing env file detected: {name}",
        sectionPublicEntry: "Public Entry",
        sectionDirectus: "Directus",
        sectionDataServices: "PostgreSQL / Redis / MinIO",
        sectionStorage: "Directus Storage",
        sectionAppSecrets: "Application Secrets",
        sectionAdminBootstrap: "Installer Admin Bootstrap",
        siteSettingsMissingTitle:
            "No site settings row found. Creating the default site settings entry.",
    },
    zh_CN: {
        unknownCommand: "未知命令：{command}",
        unknownArgument: "未知参数：{token}",
        missingArgumentValue: "{option} 缺少参数值",
        invalidLanguage: "不支持的语言：{lang}。可用值：{supported}",
        unknownInstallError: "未知安装错误",
        installFailed: "[install] 失败：{message}",
        selectLanguage:
            "请选择安装器语言 [1-4 或语言代码]（1. English / 2. 简体中文 / 3. 繁體中文 / 4. 日本語）：",
        selectLanguageRetry:
            "语言选择无效，请输入 1-4 或以下语言代码之一：{supported}。",
        promptSiteUrl: "站点公开根 URL（例如 https://example.com）：",
        unsupportedPlatform:
            "当前宿主机不受支持：{platform}。仅支持 Linux / macOS / WSL。",
        resetCleanup: "[install] 检测到 --reset，正在清理现有 Compose 资源。",
        buildImages: "[install] 构建 web / worker 镜像。",
        startInfra: "[install] 启动基础设施、seed 恢复与 Directus。",
        provisionStorage:
            "[install] 为 Directus 存储创建 MinIO service account。",
        createRole: "[install] 创建 Directus 管理员角色。",
        createAdminUser: "[install] 创建 Directus 管理员账户。",
        generateStaticToken: "[install] 登录 Directus 并生成服务端静态 token。",
        updateSiteLanguage:
            "[install] 将所选站点默认语言写入 Directus 站点设置。",
        startApp: "[install] 启动 web / worker / proxy。",
        installComplete: "[install] 安装完成。",
        configSummaryTitle: "[install] 已生成以下配置：",
        envFileWritten: "[install] .env 已写入：{path}",
        envViewHint:
            "[install] 上述所有生成值均已写入 .env，后续可直接在 .env 中查看或备份。",
        siteEntry: "[install] 主站入口：{url}",
        directusEntry: "[install] Directus：{url}",
        unsupportedSiteUrl:
            "站点 URL 非法：请使用不带 path / query / hash 的 http(s) 根 URL：{siteUrl}",
        siteUrlRequired:
            "安装器需要站点公开 URL。可交互输入，也可通过 --site-url 提供。",
        projectRootNotFound:
            "未找到项目根目录，请在包含 package.json 和 docker-compose.yml 的仓库目录内运行安装器。",
        dockerDaemonUnavailable:
            "Docker daemon 不可用。macOS / WSL 请先启动 Docker Desktop，Linux 请确认 docker 服务已启动。",
        portUnavailable: "宿主机端口不可用：{label} {host}:{port}",
        existingInstallDetected:
            "检测到现有部署，首次安装器拒绝继续：{reasons}。如确认重装，请显式传入 --reset。",
        roleIdMissing: "未能解析安装器创建的 Directus 管理员角色 ID。",
        directusAdminLoginFailed: "Directus 管理员登录失败：HTTP {status}",
        directusAccessTokenMissing:
            "Directus 登录成功，但未返回 access token。",
        directusReadAdminFailed: "读取管理员信息失败：HTTP {status}",
        directusAdminUserIdMissing: "Directus 管理员用户 ID 为空。",
        directusStaticTokenPersistFailed:
            "写入 Directus 静态 token 失败：HTTP {status}",
        waitForHealthTimeout: "等待服务健康检查超时：{url}",
        siteLanguageReadFailed:
            "写入所选站点语言前，读取当前站点设置失败：HTTP {status}",
        siteLanguageWriteFailed: "写入所选站点默认语言失败：HTTP {status}",
        composeContainerDetected: "检测到 Compose 容器记录",
        composeVolumesDetected: "检测到 Compose volumes",
        envFileDetected: "检测到现有环境文件 {name}",
        sectionPublicEntry: "Public Entry",
        sectionDirectus: "Directus",
        sectionDataServices: "PostgreSQL / Redis / MinIO",
        sectionStorage: "Directus Storage",
        sectionAppSecrets: "Application Secrets",
        sectionAdminBootstrap: "Installer Admin Bootstrap",
        siteSettingsMissingTitle:
            "未发现站点设置记录，将创建默认站点设置条目。",
    },
    zh_TW: {
        unknownCommand: "未知命令：{command}",
        unknownArgument: "未知參數：{token}",
        missingArgumentValue: "{option} 缺少參數值",
        invalidLanguage: "不支援的語言：{lang}。可用值：{supported}",
        unknownInstallError: "未知安裝錯誤",
        installFailed: "[install] 失敗：{message}",
        selectLanguage:
            "請選擇安裝器語言 [1-4 或語言代碼]（1. English / 2. 简体中文 / 3. 繁體中文 / 4. 日本語）：",
        selectLanguageRetry:
            "語言選擇無效，請輸入 1-4 或以下語言代碼之一：{supported}。",
        promptSiteUrl: "站點公開根 URL（例如 https://example.com）：",
        unsupportedPlatform:
            "目前宿主機不受支援：{platform}。僅支援 Linux / macOS / WSL。",
        resetCleanup: "[install] 偵測到 --reset，正在清理既有 Compose 資源。",
        buildImages: "[install] 建置 web / worker 映像。",
        startInfra: "[install] 啟動基礎設施、seed 還原與 Directus。",
        provisionStorage:
            "[install] 為 Directus 儲存建立 MinIO service account。",
        createRole: "[install] 建立 Directus 管理員角色。",
        createAdminUser: "[install] 建立 Directus 管理員帳號。",
        generateStaticToken:
            "[install] 登入 Directus 並產生伺服器端靜態 token。",
        updateSiteLanguage:
            "[install] 將所選站點預設語言寫入 Directus 站點設定。",
        startApp: "[install] 啟動 web / worker / proxy。",
        installComplete: "[install] 安裝完成。",
        configSummaryTitle: "[install] 已產生以下設定：",
        envFileWritten: "[install] .env 已寫入：{path}",
        envViewHint:
            "[install] 上述所有產生值均已寫入 .env，後續可直接在 .env 中檢視或備份。",
        siteEntry: "[install] 主站入口：{url}",
        directusEntry: "[install] Directus：{url}",
        unsupportedSiteUrl:
            "站點 URL 非法：請使用不帶 path / query / hash 的 http(s) 根 URL：{siteUrl}",
        siteUrlRequired:
            "安裝器需要站點公開 URL。可互動輸入，也可透過 --site-url 提供。",
        projectRootNotFound:
            "找不到專案根目錄，請在包含 package.json 和 docker-compose.yml 的倉庫目錄內執行安裝器。",
        dockerDaemonUnavailable:
            "Docker daemon 不可用。macOS / WSL 請先啟動 Docker Desktop，Linux 請確認 docker 服務已啟動。",
        portUnavailable: "宿主機連接埠不可用：{label} {host}:{port}",
        existingInstallDetected:
            "偵測到既有部署，首次安裝器拒絕繼續：{reasons}。如確認重裝，請明確傳入 --reset。",
        roleIdMissing: "無法解析安裝器建立的 Directus 管理員角色 ID。",
        directusAdminLoginFailed: "Directus 管理員登入失敗：HTTP {status}",
        directusAccessTokenMissing:
            "Directus 登入成功，但未回傳 access token。",
        directusReadAdminFailed: "讀取管理員資訊失敗：HTTP {status}",
        directusAdminUserIdMissing: "Directus 管理員使用者 ID 為空。",
        directusStaticTokenPersistFailed:
            "寫入 Directus 靜態 token 失敗：HTTP {status}",
        waitForHealthTimeout: "等待服務健康檢查逾時：{url}",
        siteLanguageReadFailed:
            "寫入所選站點語言前，讀取目前站點設定失敗：HTTP {status}",
        siteLanguageWriteFailed: "寫入所選站點預設語言失敗：HTTP {status}",
        composeContainerDetected: "偵測到 Compose 容器紀錄",
        composeVolumesDetected: "偵測到 Compose volumes",
        envFileDetected: "偵測到既有環境檔 {name}",
        sectionPublicEntry: "Public Entry",
        sectionDirectus: "Directus",
        sectionDataServices: "PostgreSQL / Redis / MinIO",
        sectionStorage: "Directus Storage",
        sectionAppSecrets: "Application Secrets",
        sectionAdminBootstrap: "Installer Admin Bootstrap",
        siteSettingsMissingTitle:
            "未發現站點設定紀錄，將建立預設站點設定條目。",
    },
    ja: {
        unknownCommand: "不明なコマンドです: {command}",
        unknownArgument: "不明な引数です: {token}",
        missingArgumentValue: "{option} に値がありません",
        invalidLanguage: "未対応の言語です: {lang}。利用可能な値: {supported}",
        unknownInstallError: "不明なインストールエラー",
        installFailed: "[install] 失敗: {message}",
        selectLanguage:
            "インストーラーの言語を選択してください [1-4 または言語コード]（1. English / 2. 简体中文 / 3. 繁體中文 / 4. 日本語）: ",
        selectLanguageRetry:
            "言語の選択が無効です。1-4 または次の言語コードを入力してください: {supported}。",
        promptSiteUrl:
            "公開サイトのルート URL を入力してください（例 https://example.com）: ",
        unsupportedPlatform:
            "現在のホストプラットフォームは未対応です: {platform}。Linux / macOS / WSL のみ対応しています。",
        resetCleanup:
            "[install] --reset を検出しました。既存の Compose リソースをクリーンアップします。",
        buildImages: "[install] web / worker イメージをビルドします。",
        startInfra:
            "[install] 基盤サービス、seed 復元ジョブ、Directus を起動します。",
        provisionStorage:
            "[install] Directus ストレージ用の MinIO service account を作成します。",
        createRole: "[install] Directus 管理者ロールを作成します。",
        createAdminUser: "[install] Directus 管理者ユーザーを作成します。",
        generateStaticToken:
            "[install] Directus にログインし、サーバー静的 token を生成します。",
        updateSiteLanguage:
            "[install] 選択したサイト既定言語を Directus に保存します。",
        startApp: "[install] web / worker / proxy を起動します。",
        installComplete: "[install] インストールが完了しました。",
        configSummaryTitle: "[install] 生成された設定の一覧:",
        envFileWritten: "[install] .env を書き込みました: {path}",
        envViewHint:
            "[install] 上記の生成値はすべて .env に保存されています。後から .env で確認・バックアップできます。",
        siteEntry: "[install] サイト入口: {url}",
        directusEntry: "[install] Directus: {url}",
        unsupportedSiteUrl:
            "サイト URL が不正です。path / query / hash を含まない http(s) のルート URL を指定してください: {siteUrl}",
        siteUrlRequired:
            "インストーラーには公開サイト URL が必要です。対話入力または --site-url で指定してください。",
        projectRootNotFound:
            "プロジェクトルートが見つかりません。package.json と docker-compose.yml を含むリポジトリでインストーラーを実行してください。",
        dockerDaemonUnavailable:
            "Docker daemon を利用できません。macOS / WSL では Docker Desktop を起動し、Linux では docker サービスを確認してください。",
        portUnavailable: "ホストポートが使用できません: {label} {host}:{port}",
        existingInstallDetected:
            "既存のデプロイを検出したため続行できません: {reasons}。再インストールする場合は --reset を指定してください。",
        roleIdMissing:
            "インストーラーが作成した Directus 管理者ロール ID を解決できませんでした。",
        directusAdminLoginFailed:
            "Directus 管理者ログインに失敗しました: HTTP {status}",
        directusAccessTokenMissing:
            "Directus ログインは成功しましたが access token が返されませんでした。",
        directusReadAdminFailed:
            "管理者情報の取得に失敗しました: HTTP {status}",
        directusAdminUserIdMissing: "Directus 管理者ユーザー ID が空です。",
        directusStaticTokenPersistFailed:
            "Directus 静的 token の保存に失敗しました: HTTP {status}",
        waitForHealthTimeout:
            "サービスのヘルスチェック待機がタイムアウトしました: {url}",
        siteLanguageReadFailed:
            "選択したサイト言語の反映前に現在のサイト設定を取得できませんでした: HTTP {status}",
        siteLanguageWriteFailed:
            "選択したサイト既定言語の保存に失敗しました: HTTP {status}",
        composeContainerDetected: "Compose コンテナ記録を検出しました",
        composeVolumesDetected: "Compose volume を検出しました",
        envFileDetected: "既存の環境ファイルを検出しました: {name}",
        sectionPublicEntry: "Public Entry",
        sectionDirectus: "Directus",
        sectionDataServices: "PostgreSQL / Redis / MinIO",
        sectionStorage: "Directus Storage",
        sectionAppSecrets: "Application Secrets",
        sectionAdminBootstrap: "Installer Admin Bootstrap",
        siteSettingsMissingTitle:
            "サイト設定行が見つからないため、既定のサイト設定を作成します。",
    },
};

/**
 * @param {unknown} value
 * @returns {value is "en" | "zh_CN" | "zh_TW" | "ja"}
 */
export function isInstallLanguage(value) {
    return typeof value === "string" && INSTALL_LANGUAGES.includes(value);
}

/**
 * @param {unknown} value
 * @returns {"en" | "zh_CN" | "zh_TW" | "ja" | null}
 */
export function normalizeInstallLanguage(value) {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = LANGUAGE_ALIASES[value.trim().toLowerCase()] || null;
    return isInstallLanguage(normalized) ? normalized : null;
}

export function formatSupportedInstallLanguages() {
    return INSTALL_LANGUAGES.join(", ");
}

/**
 * @param {string[]} argv
 * @returns {"en" | "zh_CN" | "zh_TW" | "ja" | null}
 */
export function resolveRequestedInstallLanguage(argv) {
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] !== "--lang") {
            continue;
        }
        return normalizeInstallLanguage(argv[index + 1]);
    }
    return null;
}

/**
 * @param {"en" | "zh_CN" | "zh_TW" | "ja"} lang
 * @returns {(key: keyof typeof MESSAGES.en, values?: Record<string, string | number>) => string}
 */
export function createInstallerI18n(lang) {
    const dictionary = MESSAGES[lang] || MESSAGES[DEFAULT_INSTALL_LANGUAGE];
    return (key, values = {}) => {
        const template =
            dictionary[key] || MESSAGES[DEFAULT_INSTALL_LANGUAGE][key] || key;
        return template.replace(/\{(\w+)\}/g, (_, name) =>
            Object.prototype.hasOwnProperty.call(values, name)
                ? String(values[name])
                : `{${name}}`,
        );
    };
}

export function resolveInstallLanguageChoice(input) {
    const normalized = String(input || "").trim();
    if (!normalized) {
        return null;
    }
    if (normalized === "1") {
        return "en";
    }
    if (normalized === "2") {
        return "zh_CN";
    }
    if (normalized === "3") {
        return "zh_TW";
    }
    if (normalized === "4") {
        return "ja";
    }
    return normalizeInstallLanguage(normalized);
}
