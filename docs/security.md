# Security model

## Protected data

When cloud encryption is enabled, OneDrive receives an authenticated encrypted asset snapshot, wrapped keys, and limited public protocol metadata. The storage provider can still observe account identity, directory names, object sizes, timing, and traffic. Plain mode intentionally permits the provider and anyone with file access to read asset content.

A private storage account is not a substitute for encryption. Conversely, encryption is a user choice rather than a mandatory prerequisite for synchronization.

## Trust boundaries

The DSH Host is the encryption endpoint. A remote browser does not move that endpoint to the browser's device. Native working files, Skill resources, and the currently unlocked master key are accessible to the Host and potentially to other software running as the same user. The plugin does not encrypt local working files at rest.

Microsoft tokens are stored through the configured DSH credentials provider. The standard local provider uses a private file and is not an OS keychain. No token, plaintext master key, passphrase, recovery key, or signed download URL should be logged, included in an agent tool result, or uploaded as an asset. User-selected asset content can contain secrets; the plugin cannot reliably classify every secret embedded in prose or resources.

Trusted-device automatic unlock uses a separate operating-system-protected master-key cache, not a plaintext record in the credentials provider. That cache grants the trusted Host continuing cloud decryption capability; it does not strengthen the confidentiality of local plaintext files.

## Microsoft authorization

The application is a native public client using authorization code with PKCE, one-use state, and a loopback callback. The client ID is public. No client secret is distributed. Root-directory access requires delegated `Files.ReadWrite`; this permission is broader than the dedicated folder. The application limits its own operations but cannot change the scope Microsoft grants.

Login, unlock, device-trust preferences, encryption changes, sync-target scope and risk acknowledgements, model-change application, plugin restoration and ignores, native exclusions, and additional-root participation require user actions in the plugin UI. Agent tools can inspect permitted tracking/status metadata and perform supported synchronization and backup operations, but cannot approve those grants or bypass their confirmations.

## Trusted-device automatic unlock

On a supported Windows Host, remembering unlock is enabled by default and protects the master key using CurrentUser DPAPI. An existing encrypted vault requires one successful manual unlock to establish its local cache. Ordinary shutdown wipes the running key from memory without recording a manual lock, allowing a later restart to restore a valid protected key.

Manual lock records its persistent flag and removes the active saved blob before completing. The running key is wiped even if saving the lock fails; a persistence warning must be respected because older disk data may remain. Disabling remembering removes the saved key without forcing the current session to lock. Sign-out removes automatic-unlock capability. Restarting does not bypass a successfully persisted manual lock.

The local `device-trust.json` is outside the discovery whitelist and is never synchronized. Its protected payload contains a vault-bound master key, not a passphrase or recovery key. The Windows PowerShell helper receives key/payload bytes through private stdin, returns binary output, and has bounded execution/output; command arguments contain only a static encoded program. Unsupported protection, corruption, or decryption failure remains manual-unlock only, with no plaintext fallback and no secret-bearing diagnostic output.

DPAPI is user-account protection, not a hardware guarantee or defense against software running as the same user. A protected cache is not a replacement for recovery material and is not a portable enrollment file. See [trusted-device behavior](device-trust.md) for lifecycle, failure handling, and limits.

## Key recovery and revocation

Keep the recovery key separately from synced files and the device. There is no service-operated password reset. A recovery key can unlock the current master key, allowing a new passphrase and recovery key to be issued. Every newly issued recovery key is presented immediately in a native modal dialog above the settings scroll container. The dialog explains one-time display and recovery consequences, blocks Escape dismissal and underlying-page interaction, and requires explicit safe-storage acknowledgement before confirmation. Copying does not count as acknowledgement. Recovery-key display is transient browser component state and is not returned through agent operations.

When enabling encryption or changing the passphrase succeeds in OneDrive but local file application, state persistence, or protected device-key caching fails, the settings page still presents the new recovery key. The recovery dialog explicitly reports cloud success and local failure; it does not claim the cloud change was rolled back or the whole operation completed. Save the new key before acknowledging the dialog, repair local access or storage problems, then refresh and synchronize. The new passphrase or recovery key may be needed to unlock again. Local failures do not cause the key to be logged or persisted as recovery material.

Once confirmed or the page is destroyed, the same recovery key cannot be displayed again. Closing or terminating the application can still destroy transient state; a before-unload warning is not a guarantee against forced termination. A device that can still unlock the vault can issue a replacement through the passphrase-change flow; the old recovery key is replaced in current vault metadata. Do not rely on a device cache surviving operating-system or account recovery.

A passphrase change does not revoke a device holding a usable master key. When wrapping metadata changes, the engine checks an existing key against authenticated current cloud data and retains it if valid. An invalid master key clears its local cache and locks the device. Revoking cloud authorization cannot erase previously downloaded data, and removing one local cache does not revoke other devices. Full device revocation and master-key rotation are separate capabilities outside the current design.

## Encryption enablement

Enabling encryption affects newly published state and future protocol-compliant publications. Earlier plaintext may remain in snapshots, OneDrive version history, recycle bins, backups, and other devices. Users needing confidentiality from the outset should initialize with encryption enabled.

The encrypted format detects unauthorized modifications and object substitution. It does not guarantee global freshness against a malicious provider replaying an old valid encrypted snapshot, especially on a new device without a trusted freshness anchor. Plain mode has neither cryptographic authenticity nor rollback protection against a malicious storage account.

## Native files and cross-application effects

Native DSH-home instructions and user Skills are discovered from a narrow whitelist and materialized at original relative paths. Native instructions become available through DSH's normal filesystem loaders; there is no separate library-activation switch. Previously loaded conversation context is not retroactively rewritten. `.agents` is off by default, is not accessed while disabled, and requires a separate user acknowledgement before participation because files may belong to other applications. Differing existing files require a conflict choice. Disabling a root preserves its existing local and cloud content.

Exclusions are local policy, stored with their metadata outside the discovery whitelist. Excluding requires explicit consent before deleting the current cloud asset and never removes that device's original file. Pending deletion waits for successful authorized/unlocked synchronization. This is not global exclusion or historical erasure: other devices may apply a deletion or re-upload the item, and storage history can retain earlier data. Excluded records and root grants are never serialized into asset envelopes. See [native tracking](native-assets.md).

Native writes validate logical targets and content limits before mutation, do not follow links/junctions, check for concurrent edits, and avoid recursive removal of unknown files. Resource filtering is not a general secret detector; users remain responsible for instruction bodies and resource contents.

## Portable configuration and local consent

The **Sync targets** defaults enable prompts, Skills, and reviewed DSH options, but not model configuration or plugins. Category grants and scope consent are device-local in `targets.json`; remote assets cannot change them. Existing vault upgrades require explicit confirmation before options or models participate. Disabling a category preserves local and remote copies; re-enabling starts with a fresh baseline. This is not cloud-history erasure. The separate `.agents` grant remains off by default, and disabled native categories are not read for content.

General configuration is restricted to `locale.preference`, reviewed `ui-theme` appearance/size fields, and `ui-chat` display preferences. Models use a portable subset of `llm-deepseek`, `llm-deepseek-api-key`, and `llm-pi-ai`. Export selects whitelisted user overrides from redacted settings; import rejects unexpected fields. Neither operation copies an arbitrary profile or trusts a schema dump. Keys, tokens, `apiKeyEnv` credential bindings, custom headers, security policy, device paths, and installation grants are outside this configuration scope. Text in allowed values and native assets still requires user review; the whitelist is not a general secret scanner.

All incoming model changes, including parameter changes and removals, are staged rather than immediately applied. The user must confirm the current asset fingerprint locally; local changes invalidate the pending choice. Changing an endpoint may send conversations and existing local keys to another host even though the keys themselves were never synchronized. Enabling model sync requires acknowledgement of increased exposure and attack surface. Cloud encryption does not authorize connections or make their destinations trustworthy.

Configuration conflicts are per namespace. Field-level mutations with revision checks preserve unrelated fields and local-only settings on retained providers and model entries instead of replacing the profile. The local confirmation shows previous and incoming portable overrides. Omitted provider and model-override entries reset as complete entries, which can remove their local credential references without deleting stored credential records; inherited providers may remain active. Configuration application is not a cross-namespace transaction. Pending model values and category policy are local plaintext in `targets.json`; cloud encryption does not encrypt that staging file or the Host's working configuration.

## Asset and installation safety

Plugin manifest synchronization is off by default and requires explicit local opt-in and risk acknowledgement. An enabled target exports eligible profile registry bundles as package names, exact versions, and enabled states, not installed files or arbitrary installation instructions. DSH Sync itself, shipped/core bundles, local paths, Git, tarball, and alias sources are excluded. Registry URLs and credentials are not transferred; restoration uses the destination's configured registry. A disabled target does not enumerate the plugin inventory.

Neither downloading/applying manifests nor capturing local state installs or enables code. The sidebar's concise restoration panel is populated automatically from metadata-only plugin status, not from a full settings export. A single local confirmation authorizes only selected missing-package installations and exact-version enabled-state changes, bound to both desired and observed local-state fingerprints. Stale choices are refused. Existing version/source mismatches require manual handling; there is no automatic upgrade, downgrade, or uninstall.

Installing and enabling Host plugins executes code with access to data available to the user's account. Already permitted install scripts may run. Sync does not transfer or grant build-script permissions, compatibility exemptions, or security-setting changes; blocked scripts and incompatible versions require separate action and approval in DSH's plugin manager. Encryption does not make a package trustworthy, and a package name/version is not a cryptographic publisher identity. No synchronized asset by itself authorizes execution.

Desired manifests, local observations, ignored fingerprints, and sanitized operation results are plaintext in device-local `plugins.json`, outside cloud grants. Choosing Later keeps the reminder; ignoring an item applies only to its current desired/local fingerprint, so later changes can prompt again. Missing packages remain desired instead of being treated as deletions. Installation progress, failures, and restart requirements remain separate from cloud sync success. Closing the panel does not cancel an authorized installation, and reverting a manifest cannot undo code or scripts already executed. Review instructions and Skill scripts before using or invoking them.

Resource paths reject traversal, nonportable components, and symbolic links. The plugin excludes common dependency, Git, and environment-file locations but cannot promise a generic secret scanner.

## Reporting vulnerabilities

Until a public repository and disclosure channel are established, report security concerns privately to the maintainer. Do not include real tokens, account data, or recovery material in public reports.
