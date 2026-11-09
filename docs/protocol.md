# Storage protocol, version 1

## Local-first assets

The authoritative published state is a OneDrive snapshot. Each device retains a local working collection and the content hash of every asset at its last successful sync. Local modifications survive network and authorization failures.

Native assets have stable UUIDs and prompt or Skill types. Every asset requires a validated native origin; unsupported types or missing origins are rejected without rewriting local or cloud data. A Skill is one conflict unit and includes base64-encoded resources. Deleting a known asset is represented by its absence relative to the local baseline. The baseline stores hashes, not complete historical bodies.

For each asset, equal local and cloud hashes converge. A change on only one side wins automatically. Different changes on both sides require a user choice tied to both displayed hashes. A stale choice never authorizes replacing a newer revision. Independent asset changes converge without a text merge.

## Native targets and local policy

Every prompt/Skill asset carries exactly `origin: { root, path }`, where `root` is `dsh` or `agents` and `path` is a validated root-relative instruction or Skill target. Native IDs are deterministic UUIDv8 values from the root/path. Native names and Skill metadata are canonical. Case-insensitive target collisions, traversal, arbitrary roots, and unexpected origin fields are rejected. The snapshot envelope uses format 1.

Before merging, the native adapter captures allowed working files instead of treating its previous cache as authoritative. Disabled-root and settled-exclusion remote assets pass through unchanged without local participation. A confirmed pending exclusion filters the selected ID out of the next published snapshot, including its name and origin metadata. The local `tracking.json` holds root grants, exclusions, discovered-item inventory, and pending deletion requests; none of those records appear in the cloud payload. Exclusions are not global tombstones and other devices have independent policies.

After conditional publication, the adapter checks that the real files still match the captured snapshot before writing. Per-file expected bytes are rechecked; replacements use temporary-file rename, and only known unchanged files can be removed. Unknown Skill resources prevent whole-Skill deletion. A post-publication edit or filesystem failure does not advance the stored baseline. A multi-file Skill is one merge/backup unit but not an atomic filesystem transaction. Native backup restoration writes the actual target and stages the result for the next normal cloud merge.

See [native asset tracking](native-assets.md) for the exact discovery whitelist, root opt-in, limits, and deletion consequences.

## OneDrive publication

The root directory is `DSH Sync`. The permanent `vault.json` marker identifies the format, vault UUID, and stable head item ID. Bootstrap creates uniquely named candidate objects and then creates the permanent marker with conflict behavior `fail`. A losing initializer reads the winner rather than replacing it.

Snapshots have unique UUID-based names and are uploaded before publication. The head item's **name**, rather than its contents, contains the current snapshot UUID. A metadata PATCH renames that same item with its previously read `eTag` in `If-Match`. The documented metadata update precondition is the publication boundary; stale updates return 412 and leave local state pending. A small-file content PUT is not treated as a documented compare-and-swap primitive.

A lost publication response is resolved by rereading the head and checking the proposed revision ID. Unknown outcomes must not trigger unconditional overwrite. An old reader may need to retry if a completed publication retires its predecessor snapshot. Garbage collection must never remove an unknown in-flight candidate based only on listing age.

The approach depends on real Graph metadata precondition behavior and must be tested on personal and organizational accounts. Mock tests establish adapter behavior, not Microsoft service conformance. No JSON batch or multi-file transaction is assumed.

## Snapshot envelope

Every snapshot carries `format`, `vaultId`, `revision`, `mode`, and `data`. Plain mode contains the validated asset payload directly. Encrypted mode includes a keyring and an authenticated encrypted payload. The payload contains only `assets`.

Encryption uses a random 256-bit master key and AES-256-GCM with random 96-bit nonces. Associated data binds the format, vault, revision, keyring, and purpose. A scrypt-derived key wraps the master key for passphrase access; an independent random recovery key wraps the same master key. Fixed validated KDF parameters prevent an untrusted file from requesting arbitrary memory or CPU work.

The v1 scrypt parameters are N=131072, r=8, p=1, with a random 128-bit salt and a 256-bit result. Passphrases are NFKC-normalized. The minimum length is 12 characters, which is not a guarantee of entropy. Recovery keys are random 256-bit base64url strings.

## Encryption transitions

Encryption is optional during initialization. Enabling it later reads the current head, checks for unresolved asset conflicts, uploads an encrypted replacement, and publishes it conditionally. Clients observing a new encrypted keyring stop for unlock. Once a device has observed encryption, it refuses an unexpected plaintext downgrade.

Changing the passphrase rewraps the master key, issues a new recovery key, and conditionally publishes new metadata. It does not revoke previously authorized devices. A device already holding that key authenticates the new snapshot before adopting its new keyring ID without another password prompt. A locked device whose local unlock fails may refresh a newer authenticated remote wrapper and retry; a usable local wrapper remains sufficient for offline unlock. Trusted-device key persistence is local operating-system state, not part of the cloud envelope; see [device trust](device-trust.md). Historical plaintext removal and full device revocation are not v1 promises.

## Backups and local durability

Rejected conflict versions are backed up before either side is replaced. Local state, baseline, and at most ten backups are persisted through one atomic JSON replacement. Encrypted-vault backups are encrypted, but active local assets remain plaintext for DSH use. Restoration stages an asset locally; it does not force an immediate cloud overwrite.

Published cloud state and local persistence are not a distributed transaction. If local saving fails after publication, the unchanged baseline causes the next sync to compare against the already published data. No full synchronization acknowledgement is reported until local state is saved. Encryption enablement and passphrase changes return the newly issued recovery key even if local completion fails after confirmed publication: `remotePublished: true` and `localCompleted: false` explicitly distinguish this partial outcome from publication failure. The user-only settings response carries the key; status and agent responses do not. A local state-read or protected-cache failure while saving automatic unlock must not suppress that response. Repair local access or storage and retry synchronization against the already published keyring rather than assuming rollback.

## Limits and compatibility

Asset collections are capped at 24 MiB before envelope expansion and 1000 assets. Native Skill discovery and materialization additionally cap file count, depth, and total bytes. Paths must be relative and portable; links and path traversal are rejected. Oversized or malformed remote payloads fail without replacing local assets. Unknown formats are refused, not guessed or downgraded.
