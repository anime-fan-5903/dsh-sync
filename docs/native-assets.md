# Native asset tracking

## What is discovered

DSH Sync discovers a bounded set of user-owned native assets automatically. It does not mirror the entire DSH home or profile.

| Root-relative target | Unit of synchronization |
| --- | --- |
| `AGENTS.md` | One UTF-8 prompt file |
| `prompts/**/*.md`, `prompts/**/*.txt`, `prompts/**/*.markdown` | One prompt file each |
| `fragments/**/*.md`, `fragments/**/*.txt`, `fragments/**/*.markdown` | One instruction fragment each |
| `skills/<kebab-case-name>/SKILL.md` and allowed resources | One complete Skill conflict unit |

The normal root is the configured DSH home (`DSH_HOME`, otherwise `~/.dsh`). The optional second root is `~/.agents`. The same relative scopes apply to each root. Files outside these scopes, including profiles, credentials, conversation data, plugin installations, and project-local assets, are not discovered. Instruction references outside these scopes are not followed or rewritten.

The tracking list shows prompt paths individually and a collapsed entry per Skill name, with its root and file count rather than an expanded resource listing. Discovery refreshes approximately every five seconds while the Host runs. Source edits schedule a debounced synchronization when automatic sync is enabled, the account is authorized, and the vault is unlocked. Refreshing discovery does not itself publish or replace files.

## Independent sync targets

**Sync targets** controls prompts and Skills independently. Both default to enabled, alongside DSH options; model configuration and plugin manifests default to disabled. The five target flags can be shared by **DSH Sync configuration sync**. Working flags remain in `targets.json`, but the runtime acceptance flag, `.agents` root grant, and per-item exclusions are not shared. Plugin restoration and model application still need local confirmation.

Disabling prompts or Skills stops reading that category's file contents and applying incoming changes; existing cloud assets pass through without local participation. It does not delete local or cloud files. Re-enabling resets the category's baseline so differing copies require a fresh comparison rather than an overwrite based on stale history. The separate `.agents` grant is still required for either category under that root. A previously confirmed cloud-deletion request remains separately authorized.

DSH options and model configuration are not discovered by walking profile files. They use a fixed whitelist of user overrides through the Host settings service, with namespace-level conflict units and revision-checked field mutations. A fresh, unedited device follows shared cloud preferences on its first successful unlocked sync; legacy or explicit local choices compare normally. All incoming model changes require separate fingerprint-bound local confirmation before application. See the [configuration protocol](protocol.md#portable-configuration) and [configuration security rules](security.md#portable-configuration-and-local-consent).

Plugin manifests are separate from native-file discovery. When the Plugins target is enabled, supported registry bundles are enumerated through DSH's plugin manager; installed package directories are not copied. A disabled Plugins target does not enumerate the local plugin inventory. Desired manifests and local observations, ignored fingerprints, and operation outcomes live in `plugins.json`; only validated manifests enter cloud snapshots. Missing local packages remain desired, not deletions. See the [plugin manifest protocol](protocol.md#plugin-manifests-and-local-restoration) for source restrictions and local restoration consent.

The vault-wide `syncConfig` switch defaults on and always synchronizes its own state. When off, other DSH Sync preferences do not upload or apply; local and cloud copies remain, and re-enabling compares differences again. Its independent control record is not discovered through native paths. Pausing automatic asset sync still allows signed-in, unlocked configuration checks that retain ordinary-asset baselines without publishing local file edits or applying incoming ordinary assets. See [shared configuration](protocol.md#shared-dsh-sync-configuration).

## Bidirectional files, not imported copies

Native assets retain their original filesystem locations. An incoming prompt is written to the corresponding root-relative file on the other device; an incoming Skill is materialized into its original relative Skill directory. Logical paths, not machine-specific absolute paths, identify targets. Content is not rewritten to replace usernames or absolute paths embedded in instructions.

Native asset IDs are deterministic UUIDv8 values derived from the root namespace and logical path. An identically located asset is therefore the same conflict unit on both devices. A file rename changes the native identity: the old path is a deletion and the new path a new asset. Exclusions are path-specific, so renaming an excluded item can create a newly tracked item.

If an existing local file differs from a cloud file when joining for the first time, both sides require a conflict choice. The single **Sync assets** list has no internal editor. **View** resolves the original prompt or Skill marker without reading its content, then uses DSH's Session native-application opener to launch the Host's registered default file handler. A present excluded or locked item can still be opened locally; disabled categories or roots and linked or missing paths cannot. A deployment without native opening shows an explicit error, not an internal-viewer fallback. Backup restoration writes the original location and requires that the item and root are enabled.

Native Skills are loaded through DSH's normal filesystem sources. Changes to instructions or Skill discovery take effect according to DSH's normal loading behavior; an already-running conversation does not have its past context rewritten.

## Device-local exclusions

Choose **Exclude from sync** on a tracking item. Before recording the exclusion, a modal asks for explicit consent to remove its current cloud copy if one exists. Cancellation changes nothing. Confirmation:

1. Records the exclusion and any pending cloud deletion in the plugin's local tracking settings
2. Stops reading the original files and participating in the item's merges on this device
3. Leaves the original local files in place
4. Removes the item's current cloud asset, including its origin/name metadata, on a successful authorized and unlocked synchronization

An offline or locked vault leaves the cloud deletion pending; the list shows that state. A successful sync clears the pending request but keeps the exclusion. Re-including clears the local exclusion and starts from an unknown baseline, so different existing local and remote content conflicts rather than silently overwriting either side.

The exclusion list, root opt-in flag, known-item inventory, deletion requests, and conservative baseline-reset markers live in `tracking.json` beside the plugin's local state. They are never put in a cloud snapshot or synced as assets. Local tracking metadata is plaintext, just like local working files. Excluding an item does not redact mentions of it from other tracked documents.

**Exclusions apply only to this device.** Another device that still tracks the item may apply the cloud deletion with a local backup, or may upload its changed version again. If a cloud copy reappears, an excluded row offers **Remove cloud copy** with another explicit confirmation. Configure exclusions separately on every device that should ignore the item. Cloud version history, recycle bins, retired snapshots, and other devices may retain earlier copies; removing the active cloud asset is not a promise of historical erasure.

## Optional `.agents` synchronization

The `.agents` switch is off by default on each device. While off, the adapter does not access that directory's metadata or contents, import it, or write incoming assets there. Existing remote `.agents` assets are preserved as remote-only state during unrelated DSH synchronization, including encryption changes.

Enabling requires a separate warning and acknowledgement that synchronization may overwrite prompts or Skills maintained by other applications. Existing differing files still require a conflict choice. Disabling stops participation on this device; it does not delete local or remote files. A cloud deletion explicitly confirmed before disabling remains queued because it was separately authorized.

## Filesystem safety and limits

Discovery skips version-control and dependency directories, hidden directories, temporary files, and common credential/private-key names. This is not a general secret scanner: review the tracking list and your instruction content before uploading. Symbolic links and junctions, including linked ancestors of a root, are not followed. Active unreadable, malformed, linked, or oversized candidates produce visible discovery issues and block synchronization rather than being mistaken for deletions. An identifiable excluded candidate can be inventoried without reading its content.

Paths must be portable, relative, and free of case-insensitive collisions. Collections are limited to 1000 assets and 24 MiB of canonical asset JSON. Native prompt/Skill raw content is limited to 12 MiB per asset; a Skill has at most 500 resource files; discovery is bounded to 5000 entries and 16 directory levels. Incoming materialization validates the same limits before making changes. File bytes are portable, but POSIX executable bits and other filesystem permission metadata are not synchronized.

Before publishing, the engine captures current files and preserves the previous sync baseline. Before replacing files it rechecks the captured snapshot and expected bytes. Existing targets are moved into a private, root-local `.dsh-sync-recovery/<batch>/<original-relative-path>` before replacement or deletion. The moved file is checked again, and is retained even on success so edits through an already-open handle remain recoverable. New content is published from a temporary file using an atomic, no-clobber hard link; a target created in the final check window is never overwritten. Filesystems without hard-link support fail rather than falling back to an overwriting rename.

Recovery files are local plaintext, excluded from discovery and cloud publication, and separate from the engine's ten conflict backups. At most ten recovery batches per root are accepted; old batches are never silently pruned. When full, synchronization stops before displacing another file. Review and preserve needed files, then manually move or remove old batches to make room. On a concurrent-change error, inspect recovery storage as well as the original path: the newest edit may have been moved there, and is not automatically restored over a newly created target.

Obsolete tracked files are removed deepest-first before incoming writes, allowing file/directory transitions and case-only resource renames. Preflight rejects obstructions containing untracked or skipped resources, and only empty directories are removed. A Skill's marker is updated last; a multi-file Skill is not an operating-system transaction. Intervening edits or partial filesystem failures stop acknowledgement and leave the baseline unchanged. Rejected local versions are also backed up before replacement, with the existing ten-backup cap.

## Before using synchronization

Review tracking and exclusions before initializing or joining a vault. Use harmless test instructions on two devices before relying on native file propagation. Native loading, theme/layout, and actual Microsoft transfers require live checks in addition to the isolated filesystem tests.

Windows devices can remember an OS-protected unlock key after one successful unlock; a normal restart then resumes, while manual lock persists. See [device trust](device-trust.md).
