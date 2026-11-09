# Trusted-device automatic unlock

## Purpose and defaults

A trusted device can resume encrypted synchronization after an ordinary DSH restart without asking for the passphrase again. This is a local convenience setting, not a change to cloud encryption or a replacement for the recovery key.

Remembering unlock is enabled by default only when the Host has the supported operating-system protector. The current implementation supports Windows CurrentUser DPAPI through the preinstalled Windows PowerShell executable. Unsupported runtimes remain manual-unlock only; they do not save a plaintext key as a fallback.

An existing encrypted vault needs one successful manual unlock before this device can establish its protected cache. A newly initialized encrypted vault can establish trust from its newly generated master key. Each device establishes its own trust independently; trust settings and protected blobs do not synchronize.

## What is stored

The plugin stores `device-trust.json` beside its local state, outside the native asset discovery whitelist. It contains a small versioned preference/lock record and, when enabled and successfully protected, an operating-system-protected blob bound to the vault identity.

The protected payload contains only the vault identity and its 32-byte master key. It does not contain a passphrase or recovery key. The cache is not an OAuth credential record and does not use the standard file-backed credentials provider as a substitute for secure key protection. No device-trust metadata or blob is uploaded as an asset.

Windows DPAPI protects the payload in the current Windows user's security context with a fixed application-purpose entropy value. The static PowerShell program is passed with `-NoLogo`, `-NoProfile`, `-NonInteractive`, and `-EncodedCommand`. Payload bytes are passed only through private standard input; output uses a binary pipe. Keys and protected payloads are not placed in command-line arguments, environment variables, logs, or tool results. Child output, errors, input sizes, and execution time are bounded.

## Lifecycle

| Action | Result |
| --- | --- |
| Successful initialization or manual unlock with remembering enabled | Establishes a protected local cache and clears the manual-lock flag |
| Ordinary stop or restart | Wipes the running master key from memory without recording a manual lock; a valid saved key can be restored |
| Manual lock | Records a persistent manual lock and removes the active saved blob before completing; the running key is wiped even if persistence fails |
| Successful manual unlock after locking | Clears the manual lock and can establish a new protected cache |
| Disable remembering | Removes the saved blob without forcing the current unlocked session to lock |
| Enable remembering while unlocked | Can protect the current master key |
| Enable remembering while manually locked | Does not bypass the lock or restore a key |
| Sign out | Removes local automatic-unlock capability and records a manual lock without changing the remember preference |

Restarting does not undo a successful manual lock. Restoring a key requires both the local metadata and authenticated protected payload to match the requested vault, and the decoded key must have the expected length.

The settings file is atomically replaced. If the application cannot persist a manual lock or preference change, it reports a warning rather than claiming that disk state is guaranteed. The in-memory key is still wiped for a manual lock, but a failed write can leave older on-disk data behind. Resolve the storage error before relying on the lock surviving another process start.

## Passphrase changes and device access

Changing a passphrase changes the master key's wrapping metadata; it is not device revocation. When a device already holds the master key, the engine checks that key against the authenticated current cloud data and retains it if it is still valid. An unusable master key clears automatic-unlock capability and requires manual unlock.

A trusted or currently unlocked device may therefore retain access after a passphrase change. Removing trust on one device does not erase copies on other devices. Full device revocation and master-key rotation are separate capabilities, not promises of the remember setting.

## Fail-closed behavior

Malformed or oversized metadata, invalid protected data, wrong vault binding, an incorrect key size, or a failed protector leave the cache unavailable with a safe status warning. Corrupt cache handling must not prevent the application from starting. Protection failures never cause a plaintext key file to be written, and a failed cache save must not suppress a newly issued recovery key or prevent the current successfully unlocked session from operating.

If automatic unlock is unavailable, use the passphrase or recovery key in the plugin's settings. A newly successful manual unlock can re-establish device trust when protection is available again. A protected cache is not a portable backup: account changes, operating-system recovery, or loss of the local file may make it unusable. Keep the recovery key separately even when automatic unlock works.

## Protection boundary

DPAPI supplies operating-system user-account protection. It is not a hardware-backed guarantee, proof of user presence on every unlock, or protection from malware/software able to act as the same user. The trusted Host must receive the plaintext master key in memory to decrypt cloud snapshots. Local native working files remain plaintext regardless of the trust setting.

Removing the active cache is not a promise of forensic erasure of historical disk copies. Do not distribute the trust file with the plugin or treat a copied local data directory as enrollment on another computer.

See the [security model](security.md) for cloud and Host trust boundaries and [native asset tracking](native-assets.md) for discovery scopes, exclusions, and cross-application effects.
