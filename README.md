# DSH Sync

**English** | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Sign in with your Microsoft account to synchronize your native DSH instructions and user Skills across devices, with optional cloud encryption.

**Trial release:** back up important files before use. Synchronization changes original files, and the plugin is not a backup service or a guarantee against data loss.

## Features

- Automatic synchronization of global instructions, prompt/fragment text files, and user Skills into their original paths
- One asset list, device-local exclusions, explicit conflict choices, and up to ten discarded-version backups
- Optional AES-256-GCM encryption with a passphrase and a separate recovery key
- Windows protected automatic unlock; manual unlock on other platforms
- Settings that follow DSH's active language: English, Simplified Chinese, or Japanese

Conversations, credentials, plugin installations, and arbitrary project/profile files are not synchronized. The additional `.agents` root is off by default. There is no built-in editor, text auto-merge, or team-sharing workflow.

## Get started

Tested on DSH `0.2.2-rc.1`. Nearby versions may be compatible, but compatibility is not guaranteed. Browser and Host must run on the same computer for sign-in. Organizational policies may restrict consent.

1. Install the package directory through DSH's plugin manager, restart DSH, and open **Settings → DSH Sync**.
2. Sign in with Microsoft. If the browser does not open, use **Open Microsoft sign-in**.
3. Review **Sync assets** and exclude anything that should stay local. Initialize a new vault or join the existing vault in the same account; do not reinitialize a working vault.
4. If using encryption, choose a passphrase of at least 12 characters and save the one-time recovery key separately from this device and OneDrive. On an existing encrypted vault, unlock once to establish automatic unlock on supported Windows devices.
5. Edit files normally and wait for **Synced** before switching devices. **View** opens the original file in the Host's registered application.

## Sidebar status

A live status entry above the sidebar's **More** / account launcher checks status every three seconds while the page is visible. Hover or focus it for an explanation. It distinguishes syncing, conflicts, locked vaults, inventory warnings, loading, connection failures, required sign-in/setup, paused sync, pending changes, and errors rather than reporting them as synced. Windows desktop hides the entry when the sidebar is collapsed.

Periodic difference checks compare local files and recheck OneDrive marker, head, and snapshot metadata without changing the visible status or showing a syncing spinner for unchanged snapshots. Downloading a new revision, publishing changes, or applying cloud changes locally reports syncing; errors, conflicts, and locked vaults still surface.

Clicking opens a plugin-owned dialog with the same full sync controls as **Settings → DSH Sync**; opening it does not trigger synchronization. The dialog is separate because DSH `0.2.2-rc.1` has no public navigation API for opening a specific settings section.

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
