window.__ModuleLoader__.load({
  id: 'dsh-sync',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    // BEGIN GENERATED LOCALES
    const dictionaries = {
  "en": {
    "title": "DSH Sync",
    "subtitle": "Your native assets, available on your devices. OneDrive stores the shared copy; this Host keeps the original working files.",
    "loading": "Loading sync settings…",
    "loadFailed": "Sync settings could not be loaded. Use Refresh to retry.",
    "refresh": "Refresh",
    "connection": "Microsoft account",
    "applicationHelp": "Uses the DSH Sync Microsoft application. Sign in to connect your own OneDrive account.",
    "permissionWarning": "This version requests Files.ReadWrite: access to read and write your OneDrive files, not only the DSH Sync folder. Continue only if you accept this broad permission.",
    "signIn": "Sign in with Microsoft",
    "signOut": "Sign out",
    "signedIn": "Signed in",
    "signedOut": "Not signed in",
    "authPending": "Finish signing in in the Microsoft browser tab.",
    "continueSignIn": "Open Microsoft sign-in",
    "loginLinkHelp": "If the browser did not open, use this link. Complete sign-in in a browser on the same computer as this DSH Host.",
    "invalidLoginUrl": "The server returned an unexpected Microsoft sign-in address.",
    "setup": "Set up synchronization",
    "setupHelp": "Initialize or join the DSH Sync folder at the root of your OneDrive. If a vault already exists, its encryption setting takes precedence; an encrypted vault must then be unlocked.",
    "encryptInitially": "Encrypt new cloud data end to end",
    "plainWarning": "Encryption is off by default. Your cloud assets will be readable by the storage provider and anyone with access to those files.",
    "retentionWarning": "Enabling encryption later does not erase old plaintext from cloud version history, recycle bins, snapshots, or other devices.",
    "initialize": "Initialize or join",
    "passphrase": "Passphrase",
    "confirmPassphrase": "Confirm passphrase",
    "passphraseHelp": "Use a strong, unique passphrase of at least 12 characters. Keep your recovery key separately from this device.",
    "passphraseMismatch": "The passphrases do not match.",
    "passphraseRequired": "Enter and confirm a passphrase of at least 12 characters.",
    "recoveryTitle": "Save your recovery key",
    "encryptionPublishedLocalFailed": "The encryption change succeeded in OneDrive, but this device could not finish applying or saving it, including its automatic-unlock cache. Save this new recovery key now. The cloud change was not rolled back. Fix local file access or storage problems, then refresh and sync; you may need to unlock with the new passphrase or this key.",
    "recoveryOnce": "Shown only once. Save this recovery key now. After confirmation, this exact key cannot be displayed again.",
    "recoveryWarning": "If you forget your passphrase, you need this key to unlock a new or untrusted device. Do not rely only on a remembered device: losing access to it and both secrets prevents recovery of encrypted cloud data.",
    "recoveryHelp": "Keep it somewhere safe, separate from this device and OneDrive. A newly issued recovery key replaces the previous one.",
    "recoveryCopy": "Copy recovery key",
    "recoveryCopyFailed": "Unable to copy. Select the key and copy it manually before continuing.",
    "recoverySaved": "I have saved this key somewhere safe and understand I need it if I forget my passphrase.",
    "recoveryConfirm": "I have saved the key — continue",
    "recoveryLeave": "Save your recovery key before leaving this page.",
    "overview": "Sync status",
    "phase": "Status",
    "lastSync": "Last successful sync",
    "never": "Not yet synced",
    "encryption": "Encryption",
    "encrypted": "End-to-end encrypted cloud data",
    "plaintext": "Cloud data is not end-to-end encrypted",
    "localWarning": "Local working assets are available to this DSH Host. Cloud encryption does not protect a compromised Host or erase local plaintext.",
    "locked": "Locked",
    "unlocked": "Unlocked",
    "sync": "Sync now",
    "autoSync": "Automatic sync",
    "autoHelp": "Changes sync automatically while this Host is running and authorized. Pending local changes remain on this device until sync succeeds.",
    "directory": "Host data directory",
    "security": "Vault security",
    "unlockMethod": "Unlock using",
    "usePassphrase": "Passphrase",
    "useRecovery": "Recovery key",
    "unlockSecret": "Unlock secret",
    "unlock": "Unlock",
    "lock": "Lock vault",
    "enableEncryption": "Enable encryption",
    "changePassphrase": "Change passphrase",
    "changeHelp": "Changing the passphrase also creates a new recovery key. It does not revoke devices that already hold the vault key.",
    "deviceTrustRemember": "Automatically unlock on this device",
    "deviceTrustHelp": "The vault key is protected locally by the operating system; the passphrase and recovery key are never saved. Manual lock stays locked after restart.",
    "deviceTrustUnavailable": "Secure device storage is unavailable in this runtime. Automatic unlocking is disabled; unlock manually instead.",
    "deviceTrustEstablish": "Unlock once to establish this device's OS-protected key cache.",
    "deviceTrustManualLock": "This device was manually locked. Unlock it explicitly to resume automatic unlocking.",
    "deviceTrustError": "The protected device key could not be restored. Unlock manually or disable automatic unlocking and try again.",
    "conflicts": "Resolve conflicts",
    "conflictsHelp": "Choose a version for every asset below. The discarded content is backed up locally before replacement. Choices apply only to the versions shown; changed versions require a new choice.",
    "local": "Local",
    "remote": "Cloud",
    "deleted": "Deleted",
    "present": "Present",
    "chooseVersion": "Keep version",
    "choose": "Choose…",
    "applyChoices": "Apply choices and sync",
    "assets": "Sync assets",
    "trackingHelp": "Create and edit instructions and Skills in their original supported directories; native files are discovered automatically. View opens the original file in its registered application on the DSH Host. Skills are one asset each, including resources. Tracking preferences and exclusions stay on this device.",
    "trackingRefresh": "Refresh inventory",
    "trackingLastScan": "Last inventory scan",
    "trackingDshRoot": ".dsh — tracked automatically",
    "trackingAgentsRoot": ".agents — optional",
    "trackingEmpty": "No native assets found under this root.",
    "trackingAgentsEnabled": "Track native assets under .agents on this device",
    "trackingAgentsHelp": "Off by default. Other applications may maintain this directory. Disabling .agents tracking does not delete local or remote files.",
    "trackingAgentsTitle": "Enable .agents tracking?",
    "trackingAgentsWarning": "Synchronizing .agents may overwrite prompts or Skills maintained by other applications. Enable it only if you want DSH Sync to read and apply these native assets on this device.",
    "trackingAgentsConfirm": "Enable .agents tracking",
    "trackingActive": "Tracked",
    "trackingExcluded": "Excluded on this device",
    "trackingPendingDelete": "Cloud deletion pending",
    "trackingCloudPresent": "Cloud copy present",
    "trackingRemoveCloud": "Remove cloud copy",
    "trackingMissing": "Not present locally",
    "trackingFiles": "Resource files",
    "trackingCountUnavailable": "Count unavailable",
    "trackingInclude": "Include on this device",
    "trackingExclude": "Exclude on this device",
    "trackingExcludeTitle": "Exclude this native asset?",
    "trackingExcludeLocal": "This excludes the asset only on this device. Its original local files will stay unchanged.",
    "trackingExcludeCloud": "If a cloud copy exists, its current content and metadata will be removed on a successful sync. If this device is locked or offline, cloud deletion remains pending.",
    "trackingExcludeRetention": "Old provider history or recycle bins may retain copies. Another still-tracking device may apply the cloud deletion with a backup, or upload its changed copy again.",
    "trackingExcludeConfirm": "Exclude and remove current cloud copy",
    "view": "View",
    "editorOpened": "Opened in the registered application on the DSH Host.",
    "editorUnavailable": "The DSH Host cannot open registered applications in this runtime. Open the original file on that computer, or use a desktop-enabled DSH deployment.",
    "editorOpenFailed": "The registered application could not open this file. Check its file association on the DSH Host and try again.",
    "editorInvalidPath": "The Host did not return a valid original file path. Refresh the inventory and try again.",
    "cancel": "Cancel",
    "copied": "Copied to clipboard.",
    "backups": "Local backups",
    "backupsHelp": "A bounded local safety net, not a full history. Restoring writes the original native files and stages them for sync; it may replace the current local version.",
    "emptyBackups": "No local backups.",
    "restore": "Restore",
    "restoreTitle": "Restore backup?",
    "restoreConfirm": "Restore this backup to its original native files? This may replace the current local version.",
    "confirmRestore": "Confirm restore",
    "busy": "Working…",
    "done": "Done.",
    "requestFailed": "The request failed. Retry or check the Host connection.",
    "invalidResponse": "The Host returned an unexpected response.",
    "phaseIdle": "Ready",
    "phaseSyncing": "Syncing",
    "phaseSynced": "Synced",
    "phasePending": "Local changes pending",
    "phaseConflict": "Needs conflict choices",
    "phaseLocked": "Unlock required",
    "phaseError": "Sync needs attention",
    "phaseUnknown": "Check sync status",
    "typePrompt": "Prompt",
    "typeSkill": "Skill",
    "error_bad-content-type": "The request content type is not supported.",
    "error_operation-failed": "The operation could not be completed.",
    "error_user-only": "This operation must be performed by the user in the sync settings.",
    "error_root-disabled": "Tracking is disabled for this root on this device.",
    "error_file-not-found": "The requested file could not be found. Refresh the inventory and try again.",
    "error_fixed-client-id": "DSH Sync uses its built-in Microsoft application; its application ID cannot be changed here.",
    "error_unknown-action": "The requested action is not supported.",
    "error_device-cache-failed": "The protected device key could not be saved. Automatic unlocking may be unavailable.",
    "error_device-cache-clear-failed": "The saved device key could not be cleared. Check this device's secure storage and try again.",
    "error_native-scan-failed": "The native asset inventory could not be refreshed. Check the inventory warnings.",
    "error_confirmation-required": "Review the operation's warnings and confirm it before continuing.",
    "error_invalid-data": "Some data or settings are invalid or unsupported.",
    "error_authorization-failed": "Microsoft authorization failed. Try signing in again.",
    "error_reauth-required": "Microsoft authorization must be renewed. Sign in again.",
    "error_client-id-required": "A Microsoft application ID is required to sign in.",
    "error_authorization-canceled": "Microsoft sign-in was canceled or denied.",
    "error_callback-unavailable": "The local sign-in callback could not be started. Check the Host and try again.",
    "error_authorization-timeout": "Microsoft sign-in timed out. Start signing in again.",
    "error_invalid-passphrase": "The passphrase must contain 12 to 1024 characters.",
    "error_unlock-failed": "The vault could not be unlocked. Check the passphrase or recovery key.",
    "error_locked": "The vault is locked. Unlock it before continuing.",
    "error_authentication-failed": "Encrypted data could not be authenticated. Do not overwrite it; check the vault and key.",
    "error_conflict": "Sync has conflicting versions or a previous version choice is no longer valid. Refresh and review the conflicts.",
    "error_remote-missing": "Required cloud data could not be found. Check the connected OneDrive and vault.",
    "error_wrong-vault": "The cloud data belongs to a different vault. Check the connected account and vault.",
    "error_not-initialized": "Initialize or join a sync vault before continuing.",
    "error_encryption-downgrade": "An unsafe transition to unencrypted cloud data was blocked.",
    "error_native-not-tracked": "This native asset is not currently tracked on this device. Refresh the inventory.",
    "error_local-locked": "The local sync store is locked or its process lock is invalid. Check that no other DSH process is using it before taking action.",
    "error_sync-failed": "Synchronization could not be completed. Check the sync status and try again.",
    "error_network-failed": "The cloud service could not be reached. Check the connection and try again.",
    "error_graph-error": "OneDrive could not complete the request. Check the account and connection, then try again.",
    "error_remote-changed": "Cloud data changed during this operation. Refresh the sync status before trying again.",
    "error_publication-unknown": "The cloud write result is unknown. Refresh the sync status before making further changes.",
    "error_device-protection-unavailable": "Operating-system protection for the device key is unavailable. Unlock manually.",
    "error_device-protection-failed": "The operating system could not protect or restore the device key. Unlock manually.",
    "error_device-trust-invalid": "The saved device-trust data is invalid. Unlock manually or disable automatic unlocking and try again.",
    "error_device-trust-write-failed": "Device-trust settings could not be saved. Check local access permissions and try again.",
    "error_device-trust-invalid-key": "The device key is invalid. Unlock the vault manually before trying again.",
    "error_device-trust-invalid-preference": "The automatic-unlock preference is invalid.",
    "error_native-unsafe-resource": "A native asset resource has an unsafe or unsupported path. Check the asset's resources.",
    "error_native-path-collision": "Native asset paths conflict with one another. Check the affected paths before syncing.",
    "error_native-invalid-id": "A native asset identifier does not match a supported native location.",
    "error_native-duplicate": "Duplicate native assets were found. Check their identifiers and paths.",
    "error_native-root-missing": "The native asset root is missing or unavailable on this device.",
    "error_native-linked-path": "A linked native path was rejected. Use a supported path without symbolic links or junctions.",
    "error_native-invalid-parent": "A native path has an invalid or unsupported parent directory.",
    "error_native-case-collision": "Native names conflict when letter case is ignored. Use distinct names across devices.",
    "error_native-invalid-file": "A native file has an unsupported file type or structure.",
    "error_native-limit": "A native asset exceeds a supported size, count, or path limit.",
    "error_local-changed": "Local files changed during this operation. Refresh the inventory before trying again.",
    "error_native-invalid-directory": "A native directory is invalid or unsupported.",
    "error_native-invalid-utf8": "A native text file is not valid UTF-8. Check its encoding.",
    "error_native-missing-skill": "A Skill directory is missing its required SKILL.md file.",
    "error_native-invalid-name": "A native asset name is invalid or unsupported.",
    "error_native-invalid": "A native asset could not be inspected or validated.",
    "error_EACCES": "Access was denied. Check the Host's access permissions for the affected resource.",
    "error_EPERM": "The operating system did not permit this operation. Check the Host's permissions and restrictions.",
    "error_ENOENT": "A required file or directory could not be found. Refresh and check the affected location.",
    "error_encryption-local-failed": "The encryption change succeeded in OneDrive, but this device could not finish applying or saving it, including its automatic-unlock cache. Save this new recovery key now. The cloud change was not rolled back. Fix local file access or storage problems, then refresh and sync; you may need to unlock with the new passphrase or this key."
  },
  "zh-CN": {
    "title": "DSH Sync",
    "subtitle": "让原生资产在各台设备上随时可用。OneDrive 保存共享副本；此 Host 保留原始工作文件。",
    "loading": "正在加载同步设置…",
    "loadFailed": "无法加载同步设置。请点击“刷新”重试。",
    "refresh": "刷新",
    "connection": "Microsoft 账户",
    "applicationHelp": "使用 DSH Sync 的 Microsoft 应用。请登录以连接你自己的 OneDrive 账户。",
    "permissionWarning": "此版本请求 Files.ReadWrite 权限：可读写你的 OneDrive 文件，而不只限于 DSH Sync 文件夹。仅在接受此广泛权限的情况下继续。",
    "signIn": "使用 Microsoft 登录",
    "signOut": "退出登录",
    "signedIn": "已登录",
    "signedOut": "未登录",
    "authPending": "请在 Microsoft 浏览器标签页中完成登录。",
    "continueSignIn": "打开 Microsoft 登录页面",
    "loginLinkHelp": "如果浏览器未打开，请使用此链接。请在运行此 DSH Host 的同一台计算机上使用浏览器完成登录。",
    "invalidLoginUrl": "服务器返回了非预期的 Microsoft 登录地址。",
    "setup": "设置同步",
    "setupHelp": "在 OneDrive 根目录初始化或加入 DSH Sync 文件夹。如果已存在保险库，则以其加密设置为准；如果保险库已加密，还必须将其解锁。",
    "encryptInitially": "对新的云端数据启用端到端加密",
    "plainWarning": "默认不启用加密。存储服务提供商以及任何有权访问这些文件的人都能读取你的云端资产。",
    "retentionWarning": "以后启用加密不会清除云端版本历史、回收站、快照或其他设备中的旧明文。",
    "initialize": "初始化或加入",
    "passphrase": "口令",
    "confirmPassphrase": "确认口令",
    "passphraseHelp": "请使用至少 12 个字符的高强度专用口令。请将恢复密钥与此设备分开保存。",
    "passphraseMismatch": "两次输入的口令不一致。",
    "passphraseRequired": "请输入并确认至少 12 个字符的口令。",
    "recoveryTitle": "保存恢复密钥",
    "encryptionPublishedLocalFailed": "加密更改已在 OneDrive 中成功发布，但此设备未能完成本地应用或保存（包括自动解锁缓存）。请立即保存这个新恢复密钥。云端更改并未回滚。修复本地文件访问或存储问题后，请刷新并同步；你可能需要使用新口令或此密钥解锁。",
    "recoveryOnce": "仅显示一次。请立即保存此恢复密钥。确认后，无法再次显示这一密钥。",
    "recoveryWarning": "如果忘记口令，你需要此密钥来解锁新设备或不受信任的设备。请勿仅依赖已记住的设备：如果无法再访问该设备，且同时丢失口令和恢复密钥，将无法恢复加密的云端数据。",
    "recoveryHelp": "请将其保存在安全的地方，与此设备和 OneDrive 分开存放。新签发的恢复密钥将替换之前的密钥。",
    "recoveryCopy": "复制恢复密钥",
    "recoveryCopyFailed": "无法复制。请先选中密钥并手动复制，然后再继续。",
    "recoverySaved": "我已将此密钥保存在安全的地方，并了解忘记口令时需要使用它。",
    "recoveryConfirm": "我已保存密钥，继续",
    "recoveryLeave": "离开此页面前，请先保存恢复密钥。",
    "overview": "同步状态",
    "phase": "状态",
    "lastSync": "上次成功同步",
    "never": "尚未同步",
    "encryption": "加密",
    "encrypted": "云端数据已端到端加密",
    "plaintext": "云端数据未端到端加密",
    "localWarning": "此 DSH Host 可以访问本地工作资产。云端加密无法保护已被入侵的 Host，也不会清除本地明文。",
    "locked": "已锁定",
    "unlocked": "已解锁",
    "sync": "立即同步",
    "autoSync": "自动同步",
    "autoHelp": "此 Host 运行且已获授权时，更改会自动同步。待同步的本地更改会保留在此设备上，直到同步成功。",
    "directory": "Host 数据目录",
    "security": "保险库安全",
    "unlockMethod": "解锁方式",
    "usePassphrase": "口令",
    "useRecovery": "恢复密钥",
    "unlockSecret": "解锁凭据",
    "unlock": "解锁",
    "lock": "锁定保险库",
    "enableEncryption": "启用加密",
    "changePassphrase": "更改口令",
    "changeHelp": "更改口令也会生成新的恢复密钥，但不会撤销已持有保险库密钥的设备的访问权限。",
    "deviceTrustRemember": "在此设备上自动解锁",
    "deviceTrustHelp": "保险库密钥在本地由操作系统保护；口令和恢复密钥永远不会被保存。手动锁定后，重启仍保持锁定。",
    "deviceTrustUnavailable": "当前运行环境不支持安全设备存储。自动解锁已禁用；请改为手动解锁。",
    "deviceTrustEstablish": "请先解锁一次，以在此设备上建立受操作系统保护的密钥缓存。",
    "deviceTrustManualLock": "此设备已被手动锁定。请明确执行解锁以恢复自动解锁。",
    "deviceTrustError": "无法恢复受保护的设备密钥。请手动解锁，或禁用自动解锁后重试。",
    "conflicts": "解决冲突",
    "conflictsHelp": "请为下方每项资产选择一个版本。被舍弃的内容会在替换前备份到本地。选择仅适用于当前显示的版本；版本更改后需要重新选择。",
    "local": "本地",
    "remote": "云端",
    "deleted": "已删除",
    "present": "存在",
    "chooseVersion": "保留版本",
    "choose": "请选择…",
    "applyChoices": "应用选择并同步",
    "assets": "同步资产",
    "trackingHelp": "请在受支持的原始目录中创建和编辑指令及技能；原生文件会被自动发现。“查看”会在 DSH Host 上使用已关联的应用打开原始文件。每项技能作为一项资产，包含其资源文件。跟踪偏好和排除设置仅保存在此设备上。",
    "trackingRefresh": "刷新清单",
    "trackingLastScan": "上次清单扫描",
    "trackingDshRoot": ".dsh — 自动跟踪",
    "trackingAgentsRoot": ".agents — 可选",
    "trackingEmpty": "此根目录下未发现原生资产。",
    "trackingAgentsEnabled": "在此设备上跟踪 .agents 下的原生资产",
    "trackingAgentsHelp": "默认关闭。其他应用可能也会维护此目录。禁用 .agents 跟踪不会删除本地或远程文件。",
    "trackingAgentsTitle": "启用 .agents 跟踪？",
    "trackingAgentsWarning": "同步 .agents 可能覆盖由其他应用维护的提示词或技能。仅在希望 DSH Sync 在此设备上读取并应用这些原生资产时启用。",
    "trackingAgentsConfirm": "启用 .agents 跟踪",
    "trackingActive": "已跟踪",
    "trackingExcluded": "已在此设备上排除",
    "trackingPendingDelete": "云端删除待处理",
    "trackingCloudPresent": "云端副本存在",
    "trackingRemoveCloud": "移除云端副本",
    "trackingMissing": "本地不存在",
    "trackingFiles": "资源文件",
    "trackingCountUnavailable": "无法获取数量",
    "trackingInclude": "在此设备上包含",
    "trackingExclude": "在此设备上排除",
    "trackingExcludeTitle": "排除此原生资产？",
    "trackingExcludeLocal": "仅在此设备上排除此资产。其原始本地文件将保持不变。",
    "trackingExcludeCloud": "如果存在云端副本，其当前内容和元数据将在同步成功后移除。如果此设备已锁定或离线，云端删除将保持待处理状态。",
    "trackingExcludeRetention": "服务提供商的旧版本历史或回收站可能仍保留副本。另一台仍在跟踪的设备可能会在备份后执行云端删除，也可能重新上传其已更改的副本。",
    "trackingExcludeConfirm": "排除并移除当前云端副本",
    "view": "查看",
    "editorOpened": "已在 DSH Host 上使用已关联的应用打开。",
    "editorUnavailable": "当前运行环境中的 DSH Host 无法打开已关联的应用。请在该计算机上打开原始文件，或使用支持桌面功能的 DSH 部署。",
    "editorOpenFailed": "已关联的应用无法打开此文件。请检查 DSH Host 上的文件关联，然后重试。",
    "editorInvalidPath": "Host 未返回有效的原始文件路径。请刷新清单后重试。",
    "cancel": "取消",
    "copied": "已复制到剪贴板。",
    "backups": "本地备份",
    "backupsHelp": "这是有数量限制的本地安全保障，并非完整历史记录。恢复会写入原始的原生文件，并将其标记为待同步；这可能替换当前本地版本。",
    "emptyBackups": "没有本地备份。",
    "restore": "恢复",
    "restoreTitle": "恢复备份？",
    "restoreConfirm": "将此备份恢复到其原始的原生文件？这可能替换当前本地版本。",
    "confirmRestore": "确认恢复",
    "busy": "正在处理…",
    "done": "已完成。",
    "requestFailed": "请求失败。请重试或检查 Host 连接。",
    "invalidResponse": "Host 返回了非预期的响应。",
    "phaseIdle": "就绪",
    "phaseSyncing": "正在同步",
    "phaseSynced": "已同步",
    "phasePending": "有待同步的本地更改",
    "phaseConflict": "需要选择冲突版本",
    "phaseLocked": "需要解锁",
    "phaseError": "同步需要处理",
    "phaseUnknown": "请检查同步状态",
    "typePrompt": "提示词",
    "typeSkill": "技能",
    "error_bad-content-type": "不支持此请求的内容类型。",
    "error_operation-failed": "无法完成此操作。",
    "error_user-only": "此操作必须由用户在同步设置中执行。",
    "error_root-disabled": "此设备未启用对该根目录的跟踪。",
    "error_file-not-found": "找不到所请求的文件。请刷新清单后重试。",
    "error_fixed-client-id": "DSH Sync 使用内置的 Microsoft 应用，无法在此更改应用 ID。",
    "error_unknown-action": "不支持所请求的操作。",
    "error_device-cache-failed": "无法保存受保护的设备密钥。自动解锁可能不可用。",
    "error_device-cache-clear-failed": "无法清除已保存的设备密钥。请检查此设备的安全存储后重试。",
    "error_native-scan-failed": "无法刷新原生资产清单。请检查清单警告。",
    "error_confirmation-required": "请先阅读此操作的警告并确认，再继续。",
    "error_invalid-data": "部分数据或设置无效或不受支持。",
    "error_authorization-failed": "Microsoft 授权失败。请尝试重新登录。",
    "error_reauth-required": "需要更新 Microsoft 授权。请重新登录。",
    "error_client-id-required": "登录需要 Microsoft 应用 ID。",
    "error_authorization-canceled": "Microsoft 登录已取消或被拒绝。",
    "error_callback-unavailable": "无法启动本地登录回调。请检查 Host 后重试。",
    "error_authorization-timeout": "Microsoft 登录超时。请重新开始登录。",
    "error_invalid-passphrase": "口令必须包含 12 至 1024 个字符。",
    "error_unlock-failed": "无法解锁保险库。请检查口令或恢复密钥。",
    "error_locked": "保险库已锁定。请先解锁再继续。",
    "error_authentication-failed": "无法验证加密数据。请勿覆盖它；请检查保险库和密钥。",
    "error_conflict": "同步存在版本冲突，或之前的版本选择已失效。请刷新并检查冲突。",
    "error_remote-missing": "找不到所需的云端数据。请检查已连接的 OneDrive 和保险库。",
    "error_wrong-vault": "云端数据属于另一个保险库。请检查已连接的账户和保险库。",
    "error_not-initialized": "请先初始化或加入同步保险库，再继续。",
    "error_encryption-downgrade": "已阻止向未加密云端数据的不安全转换。",
    "error_native-not-tracked": "此设备当前未跟踪该原生资产。请刷新清单。",
    "error_local-locked": "本地同步存储已锁定，或其进程锁无效。采取操作前，请确认没有其他 DSH 进程正在使用它。",
    "error_sync-failed": "无法完成同步。请检查同步状态后重试。",
    "error_network-failed": "无法连接云端服务。请检查网络连接后重试。",
    "error_graph-error": "OneDrive 无法完成请求。请检查账户和连接后重试。",
    "error_remote-changed": "云端数据在此操作期间发生了更改。请刷新同步状态后重试。",
    "error_publication-unknown": "无法确定云端写入结果。请先刷新同步状态，再进行其他更改。",
    "error_device-protection-unavailable": "操作系统的设备密钥保护不可用。请手动解锁。",
    "error_device-protection-failed": "操作系统无法保护或恢复设备密钥。请手动解锁。",
    "error_device-trust-invalid": "已保存的设备信任数据无效。请手动解锁，或禁用自动解锁后重试。",
    "error_device-trust-write-failed": "无法保存设备信任设置。请检查本地访问权限后重试。",
    "error_device-trust-invalid-key": "设备密钥无效。请先手动解锁保险库再重试。",
    "error_device-trust-invalid-preference": "自动解锁偏好设置无效。",
    "error_native-unsafe-resource": "原生资产资源的路径不安全或不受支持。请检查该资产的资源。",
    "error_native-path-collision": "原生资产路径相互冲突。请检查相关路径后再同步。",
    "error_native-invalid-id": "原生资产标识符与受支持的原生位置不匹配。",
    "error_native-duplicate": "发现重复的原生资产。请检查其标识符和路径。",
    "error_native-root-missing": "此设备上的原生资产根目录不存在或不可用。",
    "error_native-linked-path": "已拒绝链接形式的原生路径。请使用不含符号链接或联接点的受支持路径。",
    "error_native-invalid-parent": "原生路径的父目录无效或不受支持。",
    "error_native-case-collision": "忽略大小写时，原生名称发生冲突。请使用在各设备上均可区分的名称。",
    "error_native-invalid-file": "原生文件的类型或结构不受支持。",
    "error_native-limit": "原生资产超出了受支持的大小、数量或路径限制。",
    "error_local-changed": "本地文件在此操作期间发生了更改。请刷新清单后重试。",
    "error_native-invalid-directory": "原生目录无效或不受支持。",
    "error_native-invalid-utf8": "原生文本文件不是有效的 UTF-8。请检查其编码。",
    "error_native-missing-skill": "技能目录缺少必需的 SKILL.md 文件。",
    "error_native-invalid-name": "原生资产名称无效或不受支持。",
    "error_native-invalid": "无法检查或验证原生资产。",
    "error_EACCES": "访问被拒绝。请检查 Host 对相关资源的访问权限。",
    "error_EPERM": "操作系统不允许此操作。请检查 Host 的权限和限制。",
    "error_ENOENT": "找不到所需的文件或目录。请刷新并检查相关位置。",
    "error_encryption-local-failed": "加密更改已在 OneDrive 中成功发布，但此设备未能完成本地应用或保存（包括自动解锁缓存）。请立即保存这个新恢复密钥。云端更改并未回滚。修复本地文件访问或存储问题后，请刷新并同步；你可能需要使用新口令或此密钥解锁。"
  },
  "ja": {
    "title": "DSH Sync",
    "subtitle": "ネイティブアセットを各デバイスで利用できます。共有コピーは OneDrive に保存され、この Host は元の作業ファイルを保持します。",
    "loading": "同期設定を読み込み中…",
    "loadFailed": "同期設定を読み込めませんでした。「更新」で再試行してください。",
    "refresh": "更新",
    "connection": "Microsoft アカウント",
    "applicationHelp": "DSH Sync の Microsoft アプリケーションを使用します。サインインして、ご自身の OneDrive アカウントに接続してください。",
    "permissionWarning": "このバージョンは Files.ReadWrite 権限を要求します。DSH Sync フォルダーだけでなく、OneDrive のファイルを読み書きできる権限です。この広範な権限を許可する場合のみ続行してください。",
    "signIn": "Microsoft でサインイン",
    "signOut": "サインアウト",
    "signedIn": "サインイン済み",
    "signedOut": "未サインイン",
    "authPending": "ブラウザーの Microsoft タブでサインインを完了してください。",
    "continueSignIn": "Microsoft サインインを開く",
    "loginLinkHelp": "ブラウザーが開かない場合は、このリンクを使用してください。この DSH Host と同じコンピューターのブラウザーでサインインを完了してください。",
    "invalidLoginUrl": "サーバーから予期しない Microsoft サインインアドレスが返されました。",
    "setup": "同期のセットアップ",
    "setupHelp": "OneDrive のルートにある DSH Sync フォルダーを初期化するか、既存のものに参加します。保管庫が既にある場合は、その暗号化設定が優先されます。暗号化された保管庫は、その後ロックを解除する必要があります。",
    "encryptInitially": "新しいクラウドデータをエンドツーエンドで暗号化する",
    "plainWarning": "既定では暗号化は無効です。ストレージ提供者や、ファイルへのアクセス権を持つ人は、クラウド上のアセットを読み取ることができます。",
    "retentionWarning": "後から暗号化を有効にしても、クラウドのバージョン履歴、ごみ箱、スナップショット、ほかのデバイスにある古い平文は消去されません。",
    "initialize": "初期化または参加",
    "passphrase": "パスフレーズ",
    "confirmPassphrase": "パスフレーズの確認",
    "passphraseHelp": "12 文字以上の強力で使い回していないパスフレーズを使用してください。回復キーは、このデバイスとは別の場所に保管してください。",
    "passphraseMismatch": "パスフレーズが一致しません。",
    "passphraseRequired": "12 文字以上のパスフレーズを入力し、確認用にも入力してください。",
    "recoveryTitle": "回復キーを保存してください",
    "encryptionPublishedLocalFailed": "暗号化の変更は OneDrive で成功しましたが、このデバイスでの適用または保存（自動ロック解除キャッシュを含む）を完了できませんでした。この新しい回復キーを今すぐ保存してください。クラウドの変更は取り消されていません。ローカルファイルへのアクセスやストレージの問題を解決してから、更新して同期してください。新しいパスフレーズまたはこのキーでロックを解除する必要がある場合があります。",
    "recoveryOnce": "表示は一度だけです。この回復キーを今すぐ保存してください。確認後、このキーを再表示することはできません。",
    "recoveryWarning": "パスフレーズを忘れた場合、新しいデバイスや信頼されていないデバイスのロック解除にはこのキーが必要です。記憶済みのデバイスだけに頼らないでください。そのデバイスにアクセスできなくなり、パスフレーズと回復キーの両方を失うと、暗号化されたクラウドデータを復旧できません。",
    "recoveryHelp": "このデバイスや OneDrive とは別の安全な場所に保管してください。新しく発行された回復キーは、以前のキーを置き換えます。",
    "recoveryCopy": "回復キーをコピー",
    "recoveryCopyFailed": "コピーできませんでした。続行する前に、キーを選択して手動でコピーしてください。",
    "recoverySaved": "このキーを安全な場所に保存しました。パスフレーズを忘れた場合に必要であることを理解しています。",
    "recoveryConfirm": "キーを保存しました — 続行",
    "recoveryLeave": "このページを離れる前に、回復キーを保存してください。",
    "overview": "同期状態",
    "phase": "状態",
    "lastSync": "前回の同期成功",
    "never": "まだ同期していません",
    "encryption": "暗号化",
    "encrypted": "クラウドデータはエンドツーエンドで暗号化されています",
    "plaintext": "クラウドデータはエンドツーエンドで暗号化されていません",
    "localWarning": "この DSH Host はローカルの作業アセットにアクセスできます。クラウド暗号化は、侵害された Host を保護するものではなく、ローカルの平文も消去しません。",
    "locked": "ロック中",
    "unlocked": "ロック解除済み",
    "sync": "今すぐ同期",
    "autoSync": "自動同期",
    "autoHelp": "この Host が実行中で承認されている間、変更は自動的に同期されます。保留中のローカル変更は、同期が成功するまでこのデバイスに残ります。",
    "directory": "Host のデータディレクトリ",
    "security": "保管庫のセキュリティ",
    "unlockMethod": "ロック解除方法",
    "usePassphrase": "パスフレーズ",
    "useRecovery": "回復キー",
    "unlockSecret": "ロック解除用の秘密情報",
    "unlock": "ロック解除",
    "lock": "保管庫をロック",
    "enableEncryption": "暗号化を有効にする",
    "changePassphrase": "パスフレーズを変更",
    "changeHelp": "パスフレーズを変更すると、新しい回復キーも作成されます。既に保管庫のキーを保持しているデバイスのアクセス権は取り消されません。",
    "deviceTrustRemember": "このデバイスで自動的にロックを解除する",
    "deviceTrustHelp": "保管庫のキーは、ローカルでオペレーティングシステムによって保護されます。パスフレーズと回復キーは一切保存されません。手動でロックした場合、再起動後もロックされたままです。",
    "deviceTrustUnavailable": "この実行環境では安全なデバイスストレージを利用できません。自動ロック解除は無効です。手動でロックを解除してください。",
    "deviceTrustEstablish": "一度ロックを解除して、このデバイスに OS で保護されたキーキャッシュを作成してください。",
    "deviceTrustManualLock": "このデバイスは手動でロックされました。自動ロック解除を再開するには、明示的にロックを解除してください。",
    "deviceTrustError": "保護されたデバイスキーを復元できませんでした。手動でロックを解除するか、自動ロック解除を無効にして再試行してください。",
    "conflicts": "競合の解決",
    "conflictsHelp": "以下のすべてのアセットについて、バージョンを選択してください。破棄される内容は、置き換える前にローカルにバックアップされます。選択は表示中のバージョンにのみ適用されます。バージョンが変わった場合は、再度選択する必要があります。",
    "local": "ローカル",
    "remote": "クラウド",
    "deleted": "削除済み",
    "present": "存在します",
    "chooseVersion": "保持するバージョン",
    "choose": "選択…",
    "applyChoices": "選択を適用して同期",
    "assets": "同期アセット",
    "trackingHelp": "指示とスキルは、対応する元のディレクトリで作成・編集してください。ネイティブファイルは自動検出されます。「表示」は、DSH Host 上の関連付けられたアプリで元のファイルを開きます。各スキルはリソースを含めて 1 つのアセットとして扱われます。追跡設定と除外設定は、このデバイスにのみ保存されます。",
    "trackingRefresh": "一覧を更新",
    "trackingLastScan": "前回の一覧スキャン",
    "trackingDshRoot": ".dsh — 自動追跡",
    "trackingAgentsRoot": ".agents — 任意",
    "trackingEmpty": "このルート内にネイティブアセットは見つかりませんでした。",
    "trackingAgentsEnabled": "このデバイスで .agents 内のネイティブアセットを追跡する",
    "trackingAgentsHelp": "既定では無効です。ほかのアプリがこのディレクトリを管理している場合があります。.agents の追跡を無効にしても、ローカルやリモートのファイルは削除されません。",
    "trackingAgentsTitle": ".agents の追跡を有効にしますか？",
    "trackingAgentsWarning": ".agents を同期すると、ほかのアプリが管理するプロンプトやスキルが上書きされる可能性があります。このデバイス上で DSH Sync がこれらのネイティブアセットを読み取り、適用することを希望する場合のみ有効にしてください。",
    "trackingAgentsConfirm": ".agents の追跡を有効にする",
    "trackingActive": "追跡中",
    "trackingExcluded": "このデバイスで除外中",
    "trackingPendingDelete": "クラウドからの削除を保留中",
    "trackingCloudPresent": "クラウドコピーあり",
    "trackingRemoveCloud": "クラウドコピーを削除",
    "trackingMissing": "ローカルに存在しません",
    "trackingFiles": "リソースファイル",
    "trackingCountUnavailable": "件数を取得できません",
    "trackingInclude": "このデバイスで対象に含める",
    "trackingExclude": "このデバイスで除外する",
    "trackingExcludeTitle": "このネイティブアセットを除外しますか？",
    "trackingExcludeLocal": "このデバイスでのみアセットを除外します。元のローカルファイルは変更されません。",
    "trackingExcludeCloud": "クラウドコピーがある場合、同期が成功すると、その現在の内容とメタデータが削除されます。このデバイスがロック中またはオフラインの場合、クラウドからの削除は保留されます。",
    "trackingExcludeRetention": "提供者の古い履歴やごみ箱には、コピーが残る場合があります。追跡を継続している別のデバイスは、バックアップを作成したうえでクラウド上の削除を反映するか、変更済みのコピーを再度アップロードする可能性があります。",
    "trackingExcludeConfirm": "除外して現在のクラウドコピーを削除",
    "view": "表示",
    "editorOpened": "DSH Host 上の関連付けられたアプリで開きました。",
    "editorUnavailable": "この実行環境では、DSH Host は関連付けられたアプリを開けません。そのコンピューターで元のファイルを開くか、デスクトップ機能に対応した DSH 環境を使用してください。",
    "editorOpenFailed": "関連付けられたアプリでこのファイルを開けませんでした。DSH Host 上のファイルの関連付けを確認し、再試行してください。",
    "editorInvalidPath": "Host から有効な元のファイルパスが返されませんでした。一覧を更新して再試行してください。",
    "cancel": "キャンセル",
    "copied": "クリップボードにコピーしました。",
    "backups": "ローカルバックアップ",
    "backupsHelp": "保存数に上限のあるローカルの安全策であり、完全な履歴ではありません。復元すると元のネイティブファイルに書き込まれ、同期対象になります。現在のローカルバージョンが置き換えられる可能性があります。",
    "emptyBackups": "ローカルバックアップはありません。",
    "restore": "復元",
    "restoreTitle": "バックアップを復元しますか？",
    "restoreConfirm": "このバックアップを元のネイティブファイルに復元しますか？現在のローカルバージョンが置き換えられる可能性があります。",
    "confirmRestore": "復元を確定",
    "busy": "処理中…",
    "done": "完了しました。",
    "requestFailed": "リクエストに失敗しました。再試行するか、Host との接続を確認してください。",
    "invalidResponse": "Host から予期しない応答が返されました。",
    "phaseIdle": "準備完了",
    "phaseSyncing": "同期中",
    "phaseSynced": "同期済み",
    "phasePending": "ローカルの変更が保留中",
    "phaseConflict": "競合バージョンの選択が必要",
    "phaseLocked": "ロック解除が必要",
    "phaseError": "同期の確認が必要",
    "phaseUnknown": "同期状態を確認してください",
    "typePrompt": "プロンプト",
    "typeSkill": "スキル",
    "error_bad-content-type": "このリクエストのコンテンツタイプには対応していません。",
    "error_operation-failed": "操作を完了できませんでした。",
    "error_user-only": "この操作は、ユーザーが同期設定で実行する必要があります。",
    "error_root-disabled": "このデバイスでは、このルートの追跡が無効になっています。",
    "error_file-not-found": "要求されたファイルが見つかりません。一覧を更新して再試行してください。",
    "error_fixed-client-id": "DSH Sync は組み込みの Microsoft アプリケーションを使用します。ここではアプリケーション ID を変更できません。",
    "error_unknown-action": "要求された操作には対応していません。",
    "error_device-cache-failed": "保護されたデバイスキーを保存できませんでした。自動ロック解除を利用できない可能性があります。",
    "error_device-cache-clear-failed": "保存済みのデバイスキーを削除できませんでした。このデバイスの安全なストレージを確認して再試行してください。",
    "error_native-scan-failed": "ネイティブアセットの一覧を更新できませんでした。一覧の警告を確認してください。",
    "error_confirmation-required": "続行する前に、この操作の警告を確認して操作を承認してください。",
    "error_invalid-data": "一部のデータまたは設定が無効か、対応していません。",
    "error_authorization-failed": "Microsoft の承認に失敗しました。もう一度サインインしてください。",
    "error_reauth-required": "Microsoft の承認を更新する必要があります。もう一度サインインしてください。",
    "error_client-id-required": "サインインには Microsoft アプリケーション ID が必要です。",
    "error_authorization-canceled": "Microsoft サインインがキャンセルまたは拒否されました。",
    "error_callback-unavailable": "ローカルのサインインコールバックを開始できませんでした。Host を確認して再試行してください。",
    "error_authorization-timeout": "Microsoft サインインがタイムアウトしました。サインインをやり直してください。",
    "error_invalid-passphrase": "パスフレーズは 12～1024 文字で入力してください。",
    "error_unlock-failed": "保管庫のロックを解除できませんでした。パスフレーズまたは回復キーを確認してください。",
    "error_locked": "保管庫はロックされています。ロックを解除してから続行してください。",
    "error_authentication-failed": "暗号化データを認証できませんでした。上書きせず、保管庫とキーを確認してください。",
    "error_conflict": "同期するバージョンが競合しているか、以前の選択が無効になっています。更新して競合を確認してください。",
    "error_remote-missing": "必要なクラウドデータが見つかりません。接続先の OneDrive と保管庫を確認してください。",
    "error_wrong-vault": "クラウドデータは別の保管庫に属しています。接続先のアカウントと保管庫を確認してください。",
    "error_not-initialized": "同期用の保管庫を初期化するか、既存のものに参加してから続行してください。",
    "error_encryption-downgrade": "暗号化されていないクラウドデータへの安全でない移行がブロックされました。",
    "error_native-not-tracked": "このデバイスでは、現在このネイティブアセットを追跡していません。一覧を更新してください。",
    "error_local-locked": "ローカル同期ストアがロックされているか、プロセスロックが無効です。対処する前に、ほかの DSH プロセスが使用していないことを確認してください。",
    "error_sync-failed": "同期を完了できませんでした。同期状態を確認して再試行してください。",
    "error_network-failed": "クラウドサービスに接続できませんでした。接続を確認して再試行してください。",
    "error_graph-error": "OneDrive がリクエストを完了できませんでした。アカウントと接続を確認して再試行してください。",
    "error_remote-changed": "操作中にクラウドデータが変更されました。同期状態を更新してから再試行してください。",
    "error_publication-unknown": "クラウドへの書き込み結果を確認できません。さらに変更する前に同期状態を更新してください。",
    "error_device-protection-unavailable": "デバイスキーを保護する OS の機能を利用できません。手動でロックを解除してください。",
    "error_device-protection-failed": "OS がデバイスキーを保護または復元できませんでした。手動でロックを解除してください。",
    "error_device-trust-invalid": "保存済みのデバイス信頼データが無効です。手動でロックを解除するか、自動ロック解除を無効にして再試行してください。",
    "error_device-trust-write-failed": "デバイスの信頼設定を保存できませんでした。ローカルのアクセス権を確認して再試行してください。",
    "error_device-trust-invalid-key": "デバイスキーが無効です。保管庫のロックを手動で解除してから再試行してください。",
    "error_device-trust-invalid-preference": "自動ロック解除の設定値が無効です。",
    "error_native-unsafe-resource": "ネイティブアセットのリソースに、安全でないパスまたは非対応のパスがあります。アセットのリソースを確認してください。",
    "error_native-path-collision": "ネイティブアセットのパスが互いに競合しています。該当するパスを確認してから同期してください。",
    "error_native-invalid-id": "ネイティブアセットの識別子が、対応するネイティブの場所と一致しません。",
    "error_native-duplicate": "ネイティブアセットの重複が見つかりました。識別子とパスを確認してください。",
    "error_native-root-missing": "このデバイスのネイティブアセットのルートが存在しないか、利用できません。",
    "error_native-linked-path": "リンクを含むネイティブパスが拒否されました。シンボリックリンクやジャンクションを含まない対応パスを使用してください。",
    "error_native-invalid-parent": "ネイティブパスの親ディレクトリが無効か、対応していません。",
    "error_native-case-collision": "大文字と小文字を区別しない場合にネイティブの名前が競合します。各デバイスで区別できる名前を使用してください。",
    "error_native-invalid-file": "ネイティブファイルの種類または構造に対応していません。",
    "error_native-limit": "ネイティブアセットが、対応するサイズ、件数、またはパスの上限を超えています。",
    "error_local-changed": "操作中にローカルファイルが変更されました。一覧を更新してから再試行してください。",
    "error_native-invalid-directory": "ネイティブディレクトリが無効か、対応していません。",
    "error_native-invalid-utf8": "ネイティブテキストファイルが有効な UTF-8 ではありません。文字コードを確認してください。",
    "error_native-missing-skill": "スキルのディレクトリに、必須の SKILL.md ファイルがありません。",
    "error_native-invalid-name": "ネイティブアセットの名前が無効か、対応していません。",
    "error_native-invalid": "ネイティブアセットを検査または検証できませんでした。",
    "error_EACCES": "アクセスが拒否されました。該当するリソースへの Host のアクセス権を確認してください。",
    "error_EPERM": "OS がこの操作を許可しませんでした。Host の権限と制限を確認してください。",
    "error_ENOENT": "必要なファイルまたはディレクトリが見つかりません。更新して該当する場所を確認してください。",
    "error_encryption-local-failed": "暗号化の変更は OneDrive で成功しましたが、このデバイスでの適用または保存（自動ロック解除キャッシュを含む）を完了できませんでした。この新しい回復キーを今すぐ保存してください。クラウドの変更は取り消されていません。ローカルファイルへのアクセスやストレージの問題を解決してから、更新して同期してください。新しいパスフレーズまたはこのキーでロックを解除する必要がある場合があります。"
  }
};
    // END GENERATED LOCALES
    const styles = `
.dsh-sync{color:var(--dsw-alias-label-primary);max-width:960px;padding:16px;line-height:1.5;font-size:14px}
.dsh-sync *{box-sizing:border-box}.dsh-sync h2{font-size:20px;margin:0 0 8px}.dsh-sync h3{font-size:16px;margin:0 0 12px}
.dsh-sync p{margin:8px 0}.dsh-sync .ds-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:18px;margin:16px 0}
.dsh-sync .ds-muted{color:var(--dsw-alias-label-secondary)}.dsh-sync .ds-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-sync .ds-row:last-child{border-bottom:0}.dsh-sync .ds-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.dsh-sync button,.dsh-sync input,.dsh-sync select{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base)}
.dsh-sync button{padding:7px 12px;cursor:pointer}.dsh-sync button:disabled{opacity:.5;cursor:not-allowed}.dsh-sync .ds-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-sync :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dsh-sync input:not([type=checkbox]),.dsh-sync select{padding:8px;width:100%;margin-top:5px}
.dsh-sync label.ds-field{display:block;margin:12px 0}.dsh-sync input[type=checkbox]{margin-right:8px;accent-color:var(--dsw-alias-brand-primary)}
.dsh-sync .ds-warning{color:var(--dsw-alias-state-warn-primary)}.dsh-sync .ds-error{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}.dsh-sync .ds-success{color:var(--dsw-alias-state-success-primary)}
.dsh-sync .ds-value{overflow-wrap:anywhere}.dsh-sync .ds-key{display:block;white-space:pre-wrap;overflow-wrap:anywhere;padding:14px;background:var(--dsw-alias-bg-layer-2);user-select:all;font-family:ui-monospace,monospace}
.dsh-sync .ds-conflict{padding:12px 0;border-top:1px solid var(--dsw-alias-border-l1)}.dsh-sync .ds-check{display:block;margin:12px 0}.dsh-sync .ds-confirm{padding:12px;background:var(--dsw-alias-bg-layer-2);border-radius:6px;margin-top:8px}
.dsh-sync .ds-modal{position:fixed;inset:0;margin:auto;width:min(560px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:24px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;line-height:1.5}
.dsh-sync .ds-modal::backdrop{background:color-mix(in srgb,var(--dsw-alias-label-primary) 35%,transparent)}
.dsh-sync .ds-recovery-confirm{margin-top:12px;width:100%}
.dsh-sync .ds-dialog-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch;gap:8px;margin-top:16px}
.dsh-sync .ds-dialog-actions>button{width:100%;height:100%;min-height:44px;margin:0;white-space:normal}
.dsh-sync .ds-tracking-root{margin-top:18px}.dsh-sync .ds-tracking-root h4{margin:0 0 8px;font-size:14px}
.dsh-sync .ds-tracking-item{padding:12px 0;border-top:1px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere}
.dsh-sync .ds-tracking-item summary{cursor:pointer}.dsh-sync .ds-tracking-state{display:block;margin-top:4px;color:var(--dsw-alias-label-secondary)}
@media(max-width:560px){.dsh-sync{padding:8px}.dsh-sync .ds-card{padding:12px}.dsh-sync .ds-actions button{flex-grow:1}.dsh-sync .ds-dialog-actions{grid-template-columns:1fr;grid-auto-rows:1fr}}
`;
    return {
      inject: ['slots', 'locale', 'remote', 'remote.session'],
      apply(ctx) {
        // Register dictionaries only; language selection and persistence belong to DSH.
        const locales = { ...dictionaries, zh: dictionaries['zh-CN'], 'zh-Hans': dictionaries['zh-CN'] };
        for (const [language, dictionary] of Object.entries(locales)) {
          ctx.effect(() => ctx.locale.register('dsh-sync', language, dictionary));
        }
        const t = ctx.locale.bind('dsh-sync');
        function SyncSettings() {
          const locale = React.useSyncExternalStore(callback => ctx.locale.subscribe(callback), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot());
          const [status, setStatus] = React.useState(null);
          const [error, setError] = React.useState('');
          const [notice, setNotice] = React.useState('');
          const [pending, setPending] = React.useState(false);
          const [encrypted, setEncrypted] = React.useState(false);
          const [passphrase, setPassphrase] = React.useState('');
          const [confirmation, setConfirmation] = React.useState('');
          const [secret, setSecret] = React.useState('');
          const [method, setMethod] = React.useState('passphrase');
          const [recovery, setRecovery] = React.useState('');
          const [savedRecovery, setSavedRecovery] = React.useState(false);
          const [choices, setChoices] = React.useState({});
          const [confirm, setConfirm] = React.useState(null);
          const [loadError, setLoadError] = React.useState('');
          const [loginUrl, setLoginUrl] = React.useState('');
          const [recoveryCopyStatus, setRecoveryCopyStatus] = React.useState('');
          const recoveryDialog = React.useRef(null);
          const trackingDialog = React.useRef(null);
          const mounted = React.useRef(false);
          const busy = React.useRef(false);
          const fetching = React.useRef(false);
          const controllers = React.useRef(new Set());
          const version = React.useRef(0);
          const recoveryRef = React.useRef('');
          recoveryRef.current = recovery;
          const safeError = (value, secrets = []) => {
            const key = `error_${value?.code}`;
            const known = Object.hasOwn(dictionaries.en, key);
            let message = known ? t(key) : value?.messageKey ? t(value.messageKey) : typeof value?.message === 'string' ? value.message : t('requestFailed');
            if (typeof value?.code === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.code)) message = `${value.code}: ${message}`;
            if (value?.messageKey === 'invalidResponse' && value.details) message += ` (${value.details})`;
            for (const item of secrets) if (item) message = message.split(item).join('[redacted]');
            return message.slice(0, 600);
          };
          const localError = messageKey => Object.assign(new Error(), { messageKey });
          const captureError = (value, secrets = []) => ({
            code: typeof value?.code === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.code) && !secrets.some(secret => secret && value.code.includes(secret)) ? value.code : undefined,
            messageKey: value?.messageKey, details: value?.details,
            message: safeError({ message: value?.message }, secrets),
          });
          async function request(action, payload = {}) {
            const controller = new AbortController();
            controllers.current.add(controller);
            try {
              const response = await fetch('/api/dsh-sync', {
                method: action ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
                headers: action ? { 'Content-Type': 'application/json' } : undefined,
                body: action ? JSON.stringify({ action, ...payload }) : undefined,
                signal: controller.signal,
              });
              let data;
              try { data = await response.json(); } catch {
                const contentType = (response.headers?.get('content-type') ?? 'unknown').split(';')[0].replace(/[^a-zA-Z0-9/+._-]/g, '').slice(0, 80);
                throw Object.assign(localError('invalidResponse'), { details: `HTTP ${response.status}; Content-Type: ${contentType}` });
              }
              if (!response.ok || data?.ok !== true) {
                const failure = typeof data?.error?.message === 'string' ? new Error(data.error.message) : localError('requestFailed');
                if (typeof data?.error?.code === 'string') failure.code = data.error.code;
                throw failure;
              }
              return data.value;
            } finally { controllers.current.delete(controller); }
          }
          async function refresh() {
            if (!mounted.current || fetching.current || busy.current) return;
            fetching.current = true;
            const revision = version.current;
            try {
              const value = await request();
              if (mounted.current && revision === version.current) {
                setStatus(value); setLoadError('');
                if (value.signedIn || value.auth?.error) setLoginUrl('');
              }
            } catch (failure) {
              if (mounted.current && failure.name !== 'AbortError' && revision === version.current) setLoadError(captureError(failure));
            } finally { fetching.current = false; }
          }
          React.useEffect(() => {
            mounted.current = true;
            refresh();
            const timer = setInterval(() => { if (!document.hidden) refresh(); }, 3000);
            const focus = () => refresh();
            const visibility = () => { if (!document.hidden) refresh(); };
            window.addEventListener('focus', focus);
            document.addEventListener('visibilitychange', visibility);
            const beforeUnload = event => {
              if (recoveryRef.current) { event.preventDefault(); event.returnValue = ''; }
            };
            window.addEventListener('beforeunload', beforeUnload);
            return () => {
              mounted.current = false;
              clearInterval(timer);
              window.removeEventListener('focus', focus);
              document.removeEventListener('visibilitychange', visibility);
              window.removeEventListener('beforeunload', beforeUnload);
              for (const controller of controllers.current) controller.abort();
              controllers.current.clear();
              recoveryRef.current = '';
            };
          }, []);
          React.useEffect(() => {
            const dialog = recoveryDialog.current;
            if (!dialog || !recovery) return;
            // The native top layer is independent of the settings scroll position.
            // It also makes the rest of the window inert and manages modal focus.
            if (!dialog.open) dialog.showModal();
            return () => { if (dialog.open) dialog.close(); };
          }, [recovery]);
          const trackingConfirmation = ['tracking-exclude', 'agents-enable', 'restore'].includes(confirm?.kind);
          React.useEffect(() => {
            const dialog = trackingDialog.current;
            if (!dialog || !trackingConfirmation || recovery) return;
            if (!dialog.open) dialog.showModal();
            return () => { if (dialog.open) dialog.close(); };
          }, [confirm, recovery]);
          function cancelTrackingConfirmation() {
            if (!busy.current && !recoveryRef.current) setConfirm(null);
          }
          async function copyRecoveryKey() {
            const key = recoveryRef.current;
            if (!key) return;
            try {
              if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable.');
              await navigator.clipboard.writeText(key);
              if (mounted.current && recoveryRef.current === key) setRecoveryCopyStatus('copied');
            } catch {
              if (mounted.current && recoveryRef.current === key) setRecoveryCopyStatus('failed');
            }
          }
          async function run(action, payload = {}, after) {
            if (busy.current || recoveryRef.current) return;
            busy.current = true; version.current += 1;
            setPending(true); setError(''); setNotice('');
            try {
              const result = await request(action, payload);
              if (!mounted.current) return;
              if (action === 'sign-out') setLoginUrl('');
              if (result?.recoveryKey) { setRecovery(result.recoveryKey); recoveryRef.current = result.recoveryKey; setSavedRecovery(false); setRecoveryCopyStatus(''); }
              setPassphrase(''); setConfirmation(''); setSecret('');
              if (after) await after(result);
              if (mounted.current) {
                if (result?.remotePublished && result.localCompleted === false) setError({ messageKey: 'encryptionPublishedLocalFailed' });
                else setNotice(action === 'asset-open' ? 'editorOpened' : 'done');
              }
            } catch (failure) {
              if (mounted.current && failure.name !== 'AbortError') setError(captureError(failure, [payload.passphrase, payload.secret]));
            } finally {
              busy.current = false;
              if (mounted.current) { setPending(false); refresh(); }
            }
          }
          const disabled = pending || !!recovery;
          const usable = !!status?.initialized && !status?.locked;
          const card = (title, ...children) => h('section', { className: 'ds-card' }, h('h3', null, t(title)), ...children);
          const text = (key, className = 'ds-muted') => h('p', { className }, t(key));
          const button = (key, onClick, unavailable = false, primary = false) => h('button', { type: 'button', onClick, disabled: disabled || unavailable, className: primary ? 'ds-primary' : undefined }, t(key));
          const field = (key, value, onChange, props = {}) => h('label', { className: 'ds-field' }, t(key), h('input', { value, onChange: event => onChange(event.target.value), disabled, ...props }));
          const checkbox = (key, checked, onChange, unavailable = false) => h('label', { className: 'ds-check' }, h('input', { type: 'checkbox', checked: !!checked, onChange: event => onChange(event.target.checked), disabled: disabled || unavailable }), t(key));
          const row = (key, value) => h('div', { className: 'ds-row' }, h('span', { className: 'ds-muted' }, t(key)), h('span', { className: 'ds-value' }, value));
          const passphraseFields = () => h(React.Fragment, null,
            text('passphraseHelp'), field('passphrase', passphrase, setPassphrase, { type: 'password', autoComplete: 'new-password', spellCheck: false }),
            field('confirmPassphrase', confirmation, setConfirmation, { type: 'password', autoComplete: 'new-password', spellCheck: false }));
          function withPassphrase(action, extra = {}) {
            if (passphrase.length < 12 || !confirmation) { setError({ messageKey: 'passphraseRequired' }); return; }
            if (passphrase !== confirmation) { setError({ messageKey: 'passphraseMismatch' }); return; }
            run(action, { ...extra, passphrase });
          }
          function signIn() {
            if (disabled || busy.current) return;
            setLoginUrl('');
            run('sign-in', {}, result => {
              let url;
              try { url = new URL(result.url); } catch { throw localError('invalidLoginUrl'); }
              if (url.protocol !== 'https:' || url.hostname !== 'login.microsoftonline.com' || url.username || url.password) {
                throw localError('invalidLoginUrl');
              }
              setLoginUrl(url.href);
              // Desktop delegates HTTPS to the system browser and returns null.
              // Browsers may also return null with noopener or popup blocking.
              // The explicit link remains usable without interpreting that return value.
              try { window.open(url.href, '_blank', 'noopener,noreferrer'); } catch { /* Use the explicit link. */ }
            });
          }
          function openAsset(id) {
            return run('asset-open', { id }, async value => {
              const path = value?.path;
              if (typeof path !== 'string' || !/^(?:[a-zA-Z]:[\\/]|\/|\\\\)/.test(path) || /[\x00-\x1f]/.test(path)) throw localError('editorInvalidPath');
              const session = ctx.remote?.session;
              if (typeof session?.canOpenWorkspacePath !== 'function' || typeof session?.openWorkspacePath !== 'function') throw localError('editorUnavailable');
              let available;
              try { available = await session.canOpenWorkspacePath(); } catch { throw localError('editorUnavailable'); }
              if (!mounted.current) return;
              if (available?.ok !== true || available.value !== true) throw localError('editorUnavailable');
              // Match DSH's registered-application file controls; no shell or browser fallback.
              let opened;
              try { opened = await session.openWorkspacePath({ path }); } catch { throw localError('editorOpenFailed'); }
              if (!mounted.current) return;
              if (opened?.ok !== true || opened.value?.opened !== true) throw localError('editorOpenFailed');
            });
          }
          const tracking = status?.tracking ?? { agentsEnabled: false, items: [], issues: [] };
          const deviceTrust = status?.deviceTrust ?? { available: false, remember: false, manualLocked: false, hasSavedKey: false };
          const trackingOrigin = origin => `${origin?.root === 'agents' ? '.agents' : '.dsh'}/${origin?.path ?? ''}`;
          function trackingState(item) {
            return [t(item.excluded ? 'trackingExcluded' : 'trackingActive'),
              item.pendingCloudDelete && t('trackingPendingDelete'),
              item.excluded && item.cloudPresent && !item.pendingCloudDelete && t('trackingCloudPresent'),
              !item.present && t('trackingMissing')].filter(Boolean).join(' · ');
          }
          function trackingActions(item) {
            return h('div', { className: 'ds-actions' },
              item.present && button('view', () => openAsset(item.id)),
              item.excluded ? button('trackingInclude', () => run('tracking-include', { id: item.id })) :
                button('trackingExclude', () => { setError(''); setConfirm({ kind: 'tracking-exclude', id: item.id, name: item.name, origin: item.origin }); }),
              item.excluded && item.cloudPresent && !item.pendingCloudDelete && button('trackingRemoveCloud', () => {
                setError(''); setConfirm({ kind: 'tracking-exclude', id: item.id, name: item.name, origin: item.origin });
              }));
          }
          function trackingItem(item) {
            if (item.type === 'skill') return h('details', { className: 'ds-tracking-item', key: item.id },
              h('summary', null, h('strong', null, item.name), h('span', { className: 'ds-muted' }, ` · ${t('typeSkill')}`),
                h('span', { className: 'ds-tracking-state' }, trackingState(item))),
              h('p', { className: 'ds-muted' }, trackingOrigin(item.origin)),
              h('p', { className: 'ds-muted' }, `${t('trackingFiles')}: ${Number.isInteger(item.fileCount) ? item.fileCount : t('trackingCountUnavailable')}`),
              trackingActions(item));
            return h('div', { className: 'ds-tracking-item', key: item.id },
              h('strong', null, trackingOrigin(item.origin)), h('span', { className: 'ds-tracking-state' }, trackingState(item)), trackingActions(item));
          }
          const conflicts = status?.conflicts || [];
          const validChoices = conflicts.length > 0 && conflicts.every(item => choices[item.id]?.localHash === item.localHash && choices[item.id]?.remoteHash === item.remoteHash);
          const typeName = type => t({ prompt: 'typePrompt', skill: 'typeSkill' }[type] || 'assets');
          const phaseName = phase => t({ idle: 'phaseIdle', syncing: 'phaseSyncing', synced: 'phaseSynced', pending: 'phasePending', conflict: 'phaseConflict', locked: 'phaseLocked', error: 'phaseError' }[phase] || 'phaseUnknown');
          const date = value => value ? new Date(value).toLocaleString(locale.active === 'zh' ? 'zh-CN' : locale.active) : t('never');
          return h('div', { className: 'dsh-sync', 'aria-busy': pending },
            h('style', null, styles), h('h2', null, t('title')), text('subtitle'),
            (error || loadError) && h('p', { role: 'alert', className: 'ds-error' }, safeError(error || loadError)),
            notice && h('p', { role: 'status', className: 'ds-success' }, t(notice)),
            pending && h('p', { role: 'status', className: 'ds-muted' }, t('busy')),
            recovery && h('dialog', { ref: recoveryDialog, className: 'ds-modal ds-recovery-dialog', role: 'dialog', 'aria-modal': true,
              'aria-labelledby': 'dsh-sync-recovery-title', 'aria-describedby': 'dsh-sync-recovery-once dsh-sync-recovery-warning',
              onCancel: event => event.preventDefault(),
              onKeyDownCapture: event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); } } },
              h('h2', { id: 'dsh-sync-recovery-title' }, t('recoveryTitle')),
              error?.messageKey === 'encryptionPublishedLocalFailed' && h('p', { role: 'alert', className: 'ds-warning' }, t('encryptionPublishedLocalFailed')),
              h('p', { id: 'dsh-sync-recovery-once', className: 'ds-warning' }, t('recoveryOnce')),
              h('p', { id: 'dsh-sync-recovery-warning' }, t('recoveryWarning')), text('recoveryHelp'),
              h('code', { className: 'ds-key' }, recovery),
              h('div', { className: 'ds-actions' }, h('button', { type: 'button', autoFocus: true, onClick: copyRecoveryKey }, t('recoveryCopy'))),
              recoveryCopyStatus && h('p', { role: recoveryCopyStatus === 'failed' ? 'alert' : 'status', className: recoveryCopyStatus === 'failed' ? 'ds-error' : 'ds-success' }, t(recoveryCopyStatus === 'failed' ? 'recoveryCopyFailed' : 'copied')),
              h('label', { className: 'ds-check' }, h('input', { type: 'checkbox', checked: savedRecovery, onChange: event => setSavedRecovery(event.target.checked) }), t('recoverySaved')),
              h('button', { type: 'button', className: 'ds-primary ds-recovery-confirm', disabled: !savedRecovery || pending,
                onClick: () => { if (!savedRecovery || pending) return; setRecovery(''); recoveryRef.current = ''; setSavedRecovery(false); setRecoveryCopyStatus(''); } }, t('recoveryConfirm'))),
            trackingConfirmation && !recovery && h('dialog', { ref: trackingDialog, className: 'ds-modal ds-tracking-dialog', role: 'dialog', 'aria-modal': true,
              'aria-labelledby': 'dsh-sync-tracking-confirm-title',
              onCancel: event => { event.preventDefault(); cancelTrackingConfirmation(); },
              onKeyDownCapture: event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelTrackingConfirmation(); } } },
              h('h2', { id: 'dsh-sync-tracking-confirm-title' }, t(confirm.kind === 'agents-enable' ? 'trackingAgentsTitle' : confirm.kind === 'restore' ? 'restoreTitle' : 'trackingExcludeTitle')),
              confirm.kind === 'agents-enable' ? h(React.Fragment, null, text('trackingAgentsWarning', 'ds-warning'), text('trackingAgentsHelp')) :
                confirm.kind === 'restore' ? text('restoreConfirm', 'ds-warning') :
                h(React.Fragment, null, h('strong', null, confirm.name), h('p', { className: 'ds-muted' }, trackingOrigin(confirm.origin)),
                  text('trackingExcludeLocal'), text('trackingExcludeCloud', 'ds-warning'), text('trackingExcludeRetention', 'ds-warning')),
              error && h('p', { role: 'alert', className: 'ds-error' }, safeError(error)),
              h('div', { className: 'ds-dialog-actions' },
                h('button', { type: 'button', autoFocus: true, disabled: pending, onClick: cancelTrackingConfirmation }, t('cancel')),
                button(confirm.kind === 'agents-enable' ? 'trackingAgentsConfirm' : confirm.kind === 'restore' ? 'confirmRestore' : 'trackingExcludeConfirm', () => {
                  if (confirm.kind === 'agents-enable') run('tracking-configure', { agentsEnabled: true, confirmOverwrite: true }, () => setConfirm(null));
                  else if (confirm.kind === 'restore') run('backup-restore', { id: confirm.id }, () => setConfirm(null));
                  else run('tracking-exclude', { id: confirm.id, confirmCloudDelete: true }, () => setConfirm(null));
                }, confirm.kind === 'restore' && !usable, true))),
            !status ? h(React.Fragment, null, text(loadError ? 'loadFailed' : 'loading'), button('refresh', refresh)) : h(React.Fragment, null,
              card('connection', text('applicationHelp'), text('permissionWarning', 'ds-warning'),
                h('p', null, t(status.signedIn ? 'signedIn' : 'signedOut')),
                status.auth?.pending && text('authPending'),
                loginUrl && !status.signedIn && h('div', { className: 'ds-confirm' }, text('loginLinkHelp'),
                  h('a', { href: loginUrl, target: '_blank', rel: 'noopener noreferrer', style: { color: 'var(--dsw-alias-brand-primary)' } }, t('continueSignIn'))),
                status.auth?.error && h('p', { role: 'alert', className: 'ds-error' }, safeError(typeof status.auth.error === 'string' ? { message: status.auth.error } : status.auth.error)),
                h('div', { className: 'ds-actions' },
                  !status.signedIn && button('signIn', signIn, status.auth?.pending, true),
                  status.signedIn && button('signOut', () => run('sign-out')))),
              !status.initialized && card('setup', text('setupHelp'), checkbox('encryptInitially', encrypted, setEncrypted),
                !encrypted && text('plainWarning', 'ds-warning'), text('retentionWarning', 'ds-warning'), encrypted && passphraseFields(),
                button('initialize', () => encrypted ? withPassphrase('initialize', { encrypted: true }) : run('initialize', { encrypted: false }), !status.signedIn, true)),
              status.initialized && card('overview', row('phase', phaseName(status.phase)), row('lastSync', date(status.lastSync)),
                row('encryption', `${t(status.encrypted ? 'encrypted' : 'plaintext')}${status.encrypted ? ` · ${t(status.locked ? 'locked' : 'unlocked')}` : ''}`),
                status.error && h('p', { role: 'alert', className: 'ds-error' }, safeError(typeof status.error === 'string' ? { message: status.error } : status.error)),
                row('directory', status.dataDirectory || '—'), text('localWarning'),
                checkbox('autoSync', status.settings?.enabled, enabled => run('configure', { enabled })), text('autoHelp'),
                h('div', { className: 'ds-actions' }, button('sync', () => run('sync'), !status.signedIn || status.locked, true), button('refresh', refresh))),
              status.initialized && card('security',
                checkbox('deviceTrustRemember', !!deviceTrust.available && !!deviceTrust.remember, remember => run('device-trust-configure', { remember }), !deviceTrust.available),
                text(deviceTrust.available ? 'deviceTrustHelp' : 'deviceTrustUnavailable', deviceTrust.available ? 'ds-muted' : 'ds-warning'),
                deviceTrust.manualLocked && text('deviceTrustManualLock', 'ds-warning'),
                deviceTrust.available && deviceTrust.remember && !deviceTrust.manualLocked && !deviceTrust.hasSavedKey && status.encrypted && text('deviceTrustEstablish'),
                deviceTrust.error && text('deviceTrustError', 'ds-warning'),
                status.encrypted && status.locked ? h(React.Fragment, null,
                  h('label', { className: 'ds-field' }, t('unlockMethod'), h('select', { value: method, disabled, onChange: event => { setMethod(event.target.value); setSecret(''); } },
                    h('option', { value: 'passphrase' }, t('usePassphrase')), h('option', { value: 'recovery' }, t('useRecovery')))),
                  field('unlockSecret', secret, setSecret, { type: 'password', autoComplete: 'off', spellCheck: false }),
                  button('unlock', () => run('unlock', { secret, method }), !secret, true)) : h(React.Fragment, null,
                    status.encrypted ? text('changeHelp') : text('retentionWarning', 'ds-warning'), passphraseFields(),
                    h('div', { className: 'ds-actions' }, button(status.encrypted ? 'changePassphrase' : 'enableEncryption', () => withPassphrase(status.encrypted ? 'change-passphrase' : 'enable-encryption'), !status.signedIn, true),
                      status.encrypted && button('lock', () => run('lock'))))),
              conflicts.length > 0 && card('conflicts', text('conflictsHelp'), ...conflicts.map(item => {
                const selected = choices[item.id];
                const current = selected?.localHash === item.localHash && selected?.remoteHash === item.remoteHash;
                return h('div', { className: 'ds-conflict', key: item.id }, h('strong', null, item.name), h('span', { className: 'ds-muted' }, ` · ${typeName(item.type)}`),
                  item.origin && h('p', { className: 'ds-muted' }, trackingOrigin(item.origin)),
                  h('p', null, `${t('local')}: ${t(item.localDeleted ? 'deleted' : 'present')} · ${t('remote')}: ${t(item.remoteDeleted ? 'deleted' : 'present')}`),
                  h('label', { className: 'ds-field' }, t('chooseVersion'), h('select', { value: current ? selected.side : '', disabled, onChange: event => {
                    const side = event.target.value; setChoices(previous => ({ ...previous, [item.id]: side ? { side, localHash: item.localHash, remoteHash: item.remoteHash } : undefined }));
                  } }, h('option', { value: '' }, t('choose')), h('option', { value: 'local' }, `${t('local')} — ${t(item.localDeleted ? 'deleted' : 'present')}`),
                    h('option', { value: 'remote' }, `${t('remote')} — ${t(item.remoteDeleted ? 'deleted' : 'present')}`))));
              }), button('applyChoices', () => run('sync', { decisions: Object.fromEntries(conflicts.map(item => [item.id, choices[item.id]])) }, () => setChoices({})), !validChoices || !usable || !status.signedIn, true)),
              card('assets', text('trackingHelp'),
                checkbox('trackingAgentsEnabled', tracking.agentsEnabled ?? false, enabled => {
                  if (enabled) { setError(''); setConfirm({ kind: 'agents-enable' }); }
                  else run('tracking-configure', { agentsEnabled: false });
                }), text('trackingAgentsHelp'),
                h('div', { className: 'ds-actions' }, button('trackingRefresh', () => run('tracking-refresh'))),
                tracking.lastScan && row('trackingLastScan', date(tracking.lastScan)),
                ...(tracking.issues || []).map((issue, index) => h('p', { key: `${issue.code}-${index}`, role: 'alert', className: 'ds-warning' },
                  `${safeError(issue)}${issue.origin ? ` · ${trackingOrigin(issue.origin)}` : ''}`)),
                ...(tracking.agentsEnabled ? ['dsh', 'agents'] : ['dsh']).map(root => {
                  const items = (tracking.items || []).filter(item => item.origin?.root === root);
                  return h('section', { className: 'ds-tracking-root', key: root }, h('h4', null, t(root === 'dsh' ? 'trackingDshRoot' : 'trackingAgentsRoot')),
                    items.length ? items.map(trackingItem) : text('trackingEmpty'));
                })),
              card('backups', text('backupsHelp'), !(status.backups || []).length && text('emptyBackups'),
                ...(status.backups || []).map(backup => h('div', { className: 'ds-row', key: backup.id }, h('span', null, `${date(backup.createdAt)} · ${t(backup.side === 'remote' ? 'remote' : 'local')}`),
                  button('restore', () => setConfirm({ kind: 'restore', id: backup.id }), !usable))))));
        }
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'dsh-sync', order: 25, label: () => t('title'),
        }, SyncSettings)));
      },
    };
  },
});
