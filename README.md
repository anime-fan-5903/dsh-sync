# DSH Sync

**English** | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Sign in with your Microsoft account to synchronize native DSH instructions, user Skills, reviewed DSH options, and optional model configuration across devices, with optional cloud encryption.

**Trial release:** back up important files before use. Synchronization changes original files, and the plugin is not a backup service or a guarantee against data loss.

## Features

- Automatic synchronization of global instructions, prompt/fragment text files, and user Skills into their original paths
- One asset list, device-local exclusions, explicit conflict choices, and up to ten discarded-version backups
- Optional registry plugin manifests and official built-in optional plugin switches, with sidebar reminders and locally confirmed restoration
- Optional AES-256-GCM encryption with a passphrase and a separate recovery key
- Windows protected automatic unlock; manual unlock on other platforms
- Settings that follow DSH's active language: English, Simplified Chinese, or Japanese

Conversations, credentials, installed package files, and arbitrary project/profile files are not synchronized. Configuration synchronization is limited to the reviewed fields below; optional plugin manifests support locally confirmed restoration. The additional `.agents` root is off by default. There is no built-in editor, text auto-merge, or team-sharing workflow.

## Get started

Tested on DSH `0.2.2-rc.1`. Nearby versions may be compatible, but compatibility is not guaranteed. Browser and Host must run on the same computer for sign-in. Organizational policies may restrict consent.

1. Install `@anime-fan-5903/dsh-sync` from npm through DSH's plugin manager, restart DSH, and open **Settings → DSH Sync**.
2. Sign in with Microsoft. If the browser does not open, use **Open Microsoft sign-in**.
3. Review **Sync targets** and **Sync assets**, and exclude anything that should stay local. Initialize a new vault or join the existing vault in the same account; do not reinitialize a working vault.
4. If using encryption, choose a passphrase of at least 12 characters and save the one-time recovery key separately from this device and OneDrive. On an existing encrypted vault, unlock once to establish automatic unlock on supported Windows devices.
5. Edit files normally and wait for **Synced** before switching devices. **View** opens the original file in the Host's registered application.

## Settings navigation

Six horizontal tabs organize the controls: **Overview**, **Sync targets**, **Sync assets**, **Security**, **Conflicts**, and **Backups**. Switching tabs retains form entries and conflict selections while the settings remain open.

### Sync targets

Prompts, Skills, and DSH options are enabled by default; model configuration and plugins are off. Local enabling of models or plugins asks for a risk acknowledgement. Shared preferences can carry those choices to other devices, but plugin installation and model application still require local confirmation. The separate `.agents` opt-in remains off by default.

Turning a category off preserves local and cloud copies; re-enabling starts from a fresh baseline and checks differences again. This differs from an explicitly confirmed per-file exclusion, which removes the active cloud copy. The runtime scope-acceptance flag remains local even when target choices are shared.

DSH options use a fixed whitelist: `locale.preference`; `ui-theme` appearance preference and font, code-font, and terminal-font sizes; and `ui-chat` transcript, collapse, folded-reply, and performance-display preferences. Only reviewed user overrides are exported, not a schema dump or arbitrary profile configuration. Credentials, security policies, device paths, and installation permissions stay local.

Model configuration supports a portable subset of `llm-deepseek`, `llm-deepseek-api-key`, and `llm-pi-ai`: supported endpoints, model definitions, and selected inference/transport parameters. API keys, tokens, `apiKeyEnv` credential bindings, and custom headers are excluded. Enabling it locally requires a risk acknowledgement. **All incoming model changes are staged** for explicit local confirmation tied to their fingerprint, not only endpoint changes. A changed endpoint may send conversations and existing local keys to a different host; encryption does not make that connection safe.

Configuration conflicts are resolved per namespace, not per field. Application uses field-level mutations with revision checks to preserve local secrets and unrelated settings. Syncing a model asset does not mean its pending changes have been applied.

### DSH Sync configuration

**DSH Sync configuration sync** (`syncConfig`) is on by default and shared across the whole vault. Its own state always participates in synchronization, independently of the five targets. When off, other DSH Sync preferences are neither uploaded nor applied; local and cloud copies remain. Another device can turn it back on. The off state is processed before its preference payload, and re-enabling compares differing copies again instead of replaying queued local edits over the cloud.

The shared whitelist is the five target flags, automatic asset synchronization, and its interval (`intervalSeconds`, 5–3600 seconds). An unedited new device adopts existing cloud preferences on its first successful unlocked sync, without repeating target checkboxes. Existing or explicitly edited choices use normal conflict resolution. Credentials, unlock caches, device trust, `.agents` permission, exclusions, plugin ignores/results, and installation grants stay local.

Pausing automatic asset synchronization still permits minimum configuration checks while signed in and unlocked. Those checks retain ordinary-asset baselines and cloud copies without uploading local asset changes or applying incoming ordinary assets; signing out or locking still stops access.

Ordinary explanations are available from the **?** buttons beside the relevant options or card headings. Hover or focus for 500 ms to show a help bubble; click or tap to pin it for reading. Click the button again, click outside the bubble, or press Escape to dismiss it. Key warnings remain visible rather than being hidden in help bubbles.

## Sidebar status

A live status entry above the sidebar's **More** / account launcher checks status every three seconds while the page is visible. Hover or focus it for an explanation. It distinguishes syncing, conflicts, locked vaults, inventory warnings, loading, connection failures, required sign-in/setup, paused sync, pending changes, and errors rather than reporting them as synced. Windows desktop hides the entry when the sidebar is collapsed.

Periodic difference checks compare local files and recheck OneDrive marker, head, and snapshot metadata without changing the visible status or showing a syncing spinner for unchanged snapshots. Downloading a new revision, publishing changes, or applying cloud changes locally reports syncing; errors, conflicts, and locked vaults still surface.

When plugin differences are pending, the lower-left status badge opens a concise plugin restoration panel directly. Otherwise it opens the full sync controls available in **Settings → DSH Sync**. Opening either view does not install anything. The plugin-owned dialog is separate because DSH `0.2.2-rc.1` has no public navigation API for opening a specific settings section.

### Plugin restoration

After enabling **Plugins** in **Sync targets** on participating devices, eligible profile-installed registry bundles are discovered and exported automatically, including newly installed packages. Each manifest carries a package name, exact version, and desired enabled state. Official built-in optional bundles, including **Auto authorization review**, also share their enabled/disabled switch without pinning a version. A matching built-in on the destination requires local confirmation to change its switch; a missing built-in is never installed by sync. These are bundle switches, not session permission modes or plugin configuration; enabling Auto authorization review does not select Auto for a session, and disabling plugins can affect active sessions. Non-optional core bundles remain excluded, as do DSH Sync itself and local-path, Git, tarball, or alias sources. Update DSH Sync on all participating devices before sharing built-in switches: older versions reject snapshots containing these records rather than silently dropping them. Package files, registry URLs, credentials, build-script grants, and compatibility exemptions are not transferred; restoration uses the destination's configured registry.

Background comparison creates the pending list without a manual plan or a settings-page visit. Installable missing registry packages, exact-version registry activation changes, and matching eligible built-in switches are selected by default. Review names, versions, sources, and enabled states, then choose **Confirm and apply selected** for one explicit local confirmation. It authorizes only the displayed desired and local-state fingerprints; changed choices are rejected. Existing version/source mismatches require manual handling in DSH's plugin manager: there is no automatic upgrade, downgrade, or uninstall.

The restoration dialog closes automatically after all selected changes are successfully applied. Failures, stale selections, and restart-required results keep it open for review; the embedded settings panel stays visible. **Later** closes the panel but keeps the badge. Ignoring an item affects only this device and that fingerprint; a new version or local-state change can prompt again. Missing local packages remain in the desired list rather than being published as deletions. The panel reports progress, failures, script blocks, incompatibility, and restart requirements separately from cloud synchronization. Already permitted install scripts may run; new script permissions and compatibility exemptions require separate approval through DSH's plugin manager. Closing the panel does not cancel an already authorized installation.

## Safety and limits

- **Local files remain plaintext.** Cloud encryption does not protect a compromised Host, local working files, or instructions already loaded into a conversation.
- **Microsoft access is broader than the sync folder.** Delegated `Files.ReadWrite` permission is limited to that folder by plugin behavior, not by Microsoft's permission boundary. Login tokens use DSH credentials, whose default file-backed provider is not an OS keychain.
- **Keep recovery material safe.** Without a usable trusted device, passphrase, or recovery key, an encrypted vault cannot be recovered. Changing the passphrase does not revoke devices that already hold the master key. If an encryption change succeeds in OneDrive but local completion fails, save the new key shown with that warning; the cloud change is not rolled back. Repair local access or storage, then refresh and sync.
- **Exclusions are device-local.** Confirming an exclusion preserves this device's original but removes its current cloud copy. Other devices may apply that deletion or re-upload the file; cloud history may retain older copies.
- **Use an independent backup.** Multi-file updates are not filesystem transactions. File permissions, including POSIX executable bits, are not synchronized. Review synchronized instructions and scripts before using them.

Automatic unlock requires Windows CurrentUser DPAPI and the built-in Windows PowerShell. **Lock vault** persists across restarts; disabling automatic unlock removes persistence without locking the current session. Unsupported protection requires manual unlock, with no plaintext key-cache fallback.

## Further reading

- [Security and recovery](docs/security.md)
- [Native files, exclusions, and limits](docs/native-assets.md)
- [Trusted-device unlock](docs/device-trust.md)
- [Development and contributing](CONTRIBUTING.md)
- [Storage protocol](docs/protocol.md)

## License

DSH Sync is licensed under the [GNU General Public License, version 3 only](LICENSE) (`GPL-3.0-only`).
