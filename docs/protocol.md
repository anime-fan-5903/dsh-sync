# Storage protocol

## Local-first assets

The authoritative published state is a OneDrive snapshot. Each device retains a local working collection and the content hash of every asset at its last successful sync. Local modifications survive network and authorization failures.

Supported types are `prompt`, `skill`, `settings`, `model-config`, `plugins`, `sync-control`, and `sync-preferences`. Native prompts and Skills require validated native origins; configuration assets identify an explicitly supported namespace, plugin manifests identify a registry package, and the two shared-preference types have fixed singleton identities. Unsupported types and malformed records are rejected without rewriting local or cloud data. A Skill is one conflict unit and includes base64-encoded resources; a configuration namespace is one conflict unit. Deleting a known asset is represented by its absence relative to the local baseline, but a plugin's absence from the local installation does not delete its desired manifest. The baseline stores hashes, not complete historical bodies.

For each asset, equal local and cloud hashes converge. A change on only one side wins automatically. Different changes on both sides require a user choice tied to both displayed hashes. A stale choice never authorizes replacing a newer revision. Independent asset changes converge without a text merge.

## Native targets and local policy

Every prompt/Skill asset carries exactly `origin: { root, path }`, where `root` is `dsh` or `agents` and `path` is a validated root-relative instruction or Skill target. Native IDs are deterministic UUIDv8 values from the root/path. Native names and Skill metadata are canonical. Case-insensitive target collisions, traversal, arbitrary roots, and unexpected origin fields are rejected. Native-only snapshots can use format 1; configuration assets and plugin manifests require at least format 2, and shared DSH Sync records require format 3.

Before merging, the native adapter captures allowed working files instead of treating its previous cache as authoritative. Disabled-root and settled-exclusion remote assets pass through unchanged without local participation. A confirmed pending exclusion filters the selected ID out of the next published snapshot, including its name and origin metadata. The local `tracking.json` holds root grants, exclusions, discovered-item inventory, and pending deletion requests; none of those records appear in the cloud payload. Exclusions are not global tombstones and other devices have independent policies.

After conditional publication, the adapter checks that the real files still match the captured snapshot before writing. Per-file expected bytes are rechecked; existing targets move to root-local recovery storage and new content is published with a no-clobber hard link. Only known unchanged files can be removed. Unknown Skill resources prevent whole-Skill deletion. A post-publication edit or filesystem failure does not advance the stored baseline. A multi-file Skill is one merge/backup unit but not an atomic filesystem transaction. Native backup restoration writes the actual target and stages the result for the next normal cloud merge.

See [native asset tracking](native-assets.md) for the exact discovery whitelist, root opt-in, limits, and deletion consequences.

## Portable configuration

A configuration asset contains exactly `{ id, type, name, namespace, values }`. Its type is `settings` or `model-config`, and `name` equals `namespace`. Its stable UUIDv8 derives from SHA-256 of `dsh-sync-config-v1:<type>:<namespace>`, truncated to 16 bytes with UUID version/variant bits set. It has no native `origin` and cannot name an arbitrary filesystem target.

Only whitelisted, redacted user overrides are exported; resolved defaults and schema dumps are not synchronized. General namespaces and fields are:

- `locale`: `preference`
- `ui-theme`: `preference`, `fontSize`, `codeFontSize`, `terminalFontSize`
- `ui-chat`: `transcriptView`, `collapseTiming`, `foldedReplies`, `performanceUsage`

Model namespaces are `llm-deepseek`, `llm-deepseek-api-key`, and `llm-pi-ai`. Their portable subsets cover validated endpoints, supported model definitions, and selected inference/transport parameters. Keys, tokens, `apiKeyEnv`, custom headers, arbitrary profile entries, and unknown fields are not accepted. Endpoint values cannot contain user information, query strings, or fragments. Configuration validation also bounds depth, node count, and encoded size; the exact field/value whitelist lives in [portable configuration validation](../src/portable-config.js).

Each namespace is one merge/conflict asset. Applying a selected version uses field-level `settings.mutate` operations with the captured namespace revision, preserving unrelated settings and local-only fields on retained providers and model entries. A missing field resets to the target device's inherited value. Explicit model confirmation also authorizes resetting omitted provider and model-override entries as whole entries, including their local credential references; stored credential records are never deleted, and inherited providers can remain active. Missing Host namespaces do not authorize creating plugins or writing arbitrary profile entries. There is no automatic field-level conflict merge or cross-namespace transaction.

The local applied-configuration ledger records a selected asset and a hash of the user fields materialized by the Host. While those fields remain unchanged, capture retains the selected intent instead of exporting inherited values materialized by `unset`. Local portable edits invalidate the ledger. This avoids reset chatter and preserves explicit incoming values even when devices have different composition defaults. Ledger state is not synchronized.

All incoming model changes, including removals, are staged in local `targets.json`. Explicit user confirmation must match the pending asset fingerprint and unchanged local configuration before revision-checked application. A successful cloud merge does not imply that staged model changes are active.

The same file stores the working target flags and local runtime scope acceptance. Prompts, Skills, and DSH options default on; model configuration and plugins default off. Target flags can be shared by the DSH Sync preference records below; scope-acceptance and pending-model confirmation state are never serialized into those records. Local enabling of models or plugins asks for risk acknowledgement. Neither capture nor remote application installs packages. Disabled categories pass remote assets through without local application or deletion; re-enabling resets their baseline. `.agents` participation and native exclusions remain separate local policy in `tracking.json`.

## Shared DSH Sync configuration

`syncConfig` defaults to true. Its `sync-control` record contains exactly `{ id, type, name, enabled }`, with canonical name `DSH Sync configuration sync`. The optional `sync-preferences` payload contains exactly `{ id, type, name, values }`, with canonical name `DSH Sync preferences`. Its `values` contains exactly `targets`, `autoSync`, and `intervalSeconds`: all five target flags are required booleans, `autoSync` is boolean, and the interval is an integer from 5 through 3600 seconds. Unknown fields and device grants are rejected by [preference-record validation](../src/preference-records.js).

Both records are singletons. Their UUIDv8 IDs derive from SHA-256 of `dsh-sync-preferences-v1:control` and `dsh-sync-preferences-v1:preferences`, respectively, truncated to 16 bytes with UUID version/variant bits set. The control always participates independently of the five asset targets and its own enabled state. It is shared across the whole vault, not a per-device exclusion.

Reconciliation selects the control before considering its payload. A resolved switch can publish and advance its own baseline while preference or ordinary-asset conflicts remain unresolved; their cloud data and baselines stay unchanged. An off result prevents local preference export and incoming preference application; the existing cloud payload passes through unchanged and local settings remain. Re-enabling resets the preference comparison baseline, so differing local and cloud copies require fingerprint-bound conflict resolution rather than replaying edits made while disabled. A fresh, unedited device follows existing cloud preferences on its first successful unlocked sync. Legacy or explicitly edited choices participate in the normal comparison instead of being silently replaced.

The payload excludes credentials, unlock keys and caches, device-trust state, runtime acceptance and confirmation flags, `.agents` permission, native exclusions, plugin ignores/results/observations, script grants, engine exemptions, and paths. Receiving target flags does not authorize plugin installation or model application; both keep their local confirmation flows.

`preferences.json` stores only local enabled/edit/known/reset metadata: `format`, `enabled`, `controlEdited`, `configEdited`, `configKnown`, and `reset`. Actual target choices and automatic-sync settings remain in their existing target/state files; those files are not mirrored. The public synchronization entry checks shared configuration before ordinary discovery and application, so ordinary-asset failures do not block its control phase. A later asset failure is still reported without rolling back already synchronized preferences. When automatic asset sync is paused, signed-in and unlocked devices continue minimum configuration checks. Such checks retain ordinary-asset baselines and preserve ordinary remote assets without publishing local ordinary changes or applying incoming ordinary assets. They do not bypass sign-out or a locked vault.

## Plugin manifests and local restoration

A plugin asset contains exactly `{ id, type: 'plugins', name, version, enabled, source: 'registry' }`. Its stable UUIDv8 derives from SHA-256 of `dsh-sync-plugin-v1:<name>`, truncated to 16 bytes with UUID version/variant bits set. Each package is one conflict unit. The version is exact, not a range; the manifest carries no registry URL, credentials, install command, package bytes, build grants, or compatibility exemptions.

When the Plugins target is enabled, capture enumerates the Host plugin manager's profile-installed bundles and automatically exports eligible registry packages and their enabled states. Later local installations are detected without manually creating a restoration plan. DSH Sync itself, shipped/core bundles, local paths, Git repositories, tarballs, aliases, and unsupported or read-only entries are excluded. Restoration resolves the exact package/version through the destination's own configured registry, not a synchronized source URL. A disabled target does not enumerate the local plugin inventory.

Device-local `plugins.json` stores desired manifests, observed local-state hashes, ignored fingerprints, and sanitized operation results. Missing local packages retain their desired manifest rather than becoming cloud deletions. Only validated manifests enter snapshots; observations, ignores, results, and authorization are not synchronized. Both capture and remote application update metadata only and never install or enable packages.

Background comparisons expose missing packages, activation changes, and manual version/source differences. The sidebar opens a concise restoration panel using metadata-only `GET /api/dsh-sync?view=plugins`, without fetching full settings or requiring a manually created plan. Installable missing packages and exact-version activation changes are selected by default. One explicit local confirmation submits the selected IDs and fingerprints binding both the desired manifests and observed local state; stale selections are refused, including changes detected between asynchronous operations. DSH's `pluginManager` service performs exact-version installations or enabled-state changes. Existing version/source mismatches require manual management; synchronization never automatically upgrades, downgrades, or uninstalls them.

Choosing Later preserves the reminder. Per-item ignores are device-local and fingerprint-bound; a new version or changed local state can prompt again. Progress, failure, blocked scripts, incompatibility, and restart-required outcomes are distinct from cloud synchronization success. Existing local script permissions may allow scripts to run, but sync never transfers or grants new script permissions or engine exemptions. Such approvals remain separate plugin-manager actions. Closing the panel does not cancel an installation already authorized on this device.

## OneDrive publication

The root directory is `DSH Sync`. The permanent `vault.json` marker remains at format 1 and identifies the vault UUID and stable head item ID; its version is independent of the snapshot envelope version. Bootstrap creates uniquely named candidate objects and then creates the permanent marker with conflict behavior `fail`. A losing initializer reads the winner rather than replacing it.

Snapshots have unique UUID-based names and are uploaded before publication. The head item's **name**, rather than its contents, contains the current snapshot UUID. A metadata PATCH renames that same item with its previously read `eTag` in `If-Match`. The documented metadata update precondition is the publication boundary; stale updates return 412 and leave local state pending. A small-file content PUT is not treated as a documented compare-and-swap primitive.

A lost publication response is resolved by rereading the head and checking the proposed revision ID. Unknown outcomes must not trigger unconditional overwrite. An old reader may need to retry if a completed publication retires its predecessor snapshot. Garbage collection must never remove an unknown in-flight candidate based only on listing age.

The approach depends on real Graph metadata precondition behavior and must be tested on personal and organizational accounts. Mock tests establish adapter behavior, not Microsoft service conformance. No JSON batch or multi-file transaction is assumed.

## Runtime OneDrive reader

The transport retains at most one identity-checked snapshot in memory, keyed by drive, folder, head item, vault, revision, head `eTag`, and snapshot item ID and `eTag`. Every read revalidates the marker, head, and snapshot metadata before reusing that snapshot; a new or changed snapshot is downloaded and checked for the expected format, vault, and revision. Missing snapshot `eTag` disables cache reuse. Encrypted payload authentication remains the sync engine's responsibility when decoding the snapshot, not the transport cache's. Metadata failures are reported, never hidden by a cached fallback. This cache adds no durable storage and changes no protocol format.

Periodic checks compare local files and remote metadata while retaining the current visible status for unchanged snapshots. Downloading a new revision, actual publication, and local application report syncing; errors, conflicts, and locked vaults remain visible.

## Snapshot envelope

Every snapshot carries `format`, `vaultId`, `revision`, `mode`, and `data`. Format 1 remains readable for native-only assets; format 2 also supports portable configuration and plugin manifests; format 3 adds `sync-control` and `sync-preferences`. Each record requires its minimum format. Older clients refuse unsupported versions or types before writing rather than dropping records. An observed format 3 remains the publication minimum even if its singleton records are absent from a later local collection. Formats 1 and 2 remain readable; the permanent vault marker stays at format 1. Unknown versions are refused.

Plain mode contains the validated asset payload directly. Encrypted mode includes a keyring and an authenticated encrypted payload. The payload contains only `assets`. Snapshot cryptographic associated data binds the envelope version through distinct `snapshot`, `snapshot-v2`, and `snapshot-v3` purposes; changing the version of an encrypted envelope cannot reinterpret its authenticated payload.

Encryption uses a random 256-bit master key and AES-256-GCM with random 96-bit nonces. Associated data binds the format, vault, revision, keyring, and purpose. A scrypt-derived key wraps the master key for passphrase access; an independent random recovery key wraps the same master key. Fixed validated KDF parameters prevent an untrusted file from requesting arbitrary memory or CPU work.

The v1 scrypt parameters are N=131072, r=8, p=1, with a random 128-bit salt and a 256-bit result. Passphrases are NFKC-normalized. The minimum length is 12 characters, which is not a guarantee of entropy. Recovery keys are random 256-bit base64url strings.

## Encryption transitions

Encryption is optional during initialization. Enabling it later reads the current head, checks for unresolved asset conflicts, uploads an encrypted replacement, and publishes it conditionally. Clients observing a new encrypted keyring stop for unlock. Once a device has observed encryption, it refuses an unexpected plaintext downgrade.

Changing the passphrase rewraps the master key, issues a new recovery key, and conditionally publishes new metadata. It does not revoke previously authorized devices. A device already holding that key authenticates the new snapshot before adopting its new keyring ID without another password prompt. A locked device whose local unlock fails may refresh a newer authenticated remote wrapper and retry; a usable local wrapper remains sufficient for offline unlock. Trusted-device key persistence is local operating-system state, not part of the cloud envelope; see [device trust](device-trust.md). Historical plaintext removal and full device revocation are not v1 promises.

## Backups and local durability

Rejected recoverable asset versions are backed up before either side is replaced. The two shared-preference singleton types have no ordinary asset restoration action and are excluded from this ten-backup quota. Local state, baseline, and at most ten backups are persisted through one atomic JSON replacement. Encrypted-vault backups are encrypted, but active local assets remain plaintext for DSH use. Restoration stages an asset locally; it does not force an immediate cloud overwrite.

Published cloud state and local persistence are not a distributed transaction. If local saving fails after publication, the unchanged baseline causes the next sync to compare against the already published data. No full synchronization acknowledgement is reported until local state is saved. Encryption enablement and passphrase changes return the newly issued recovery key even if local completion fails after confirmed publication: `remotePublished: true` and `localCompleted: false` explicitly distinguish this partial outcome from publication failure. The user-only settings response carries the key; status and agent responses do not. A local state-read or protected-cache failure while saving automatic unlock must not suppress that response. Repair local access or storage and retry synchronization against the already published keyring rather than assuming rollback.

## Limits and compatibility

Asset collections are capped at 24 MiB before envelope expansion and 1000 assets. Native Skill discovery and materialization additionally cap file count, depth, and total bytes. Paths must be relative and portable; links and path traversal are rejected. Oversized or malformed remote payloads fail without replacing local assets. Unknown formats are refused, not guessed or downgraded.
