# Project instructions

Read [CONTRIBUTING](CONTRIBUTING.md) for environment setup, source installation, verification commands, and completion criteria. Keep this repository independently usable; do not require parent-workspace files or developer-machine paths.

- Use English for code, comments, identifiers, documentation, and Conventional Commit messages; translated READMEs and localization values may use their target languages
- Keep protocol/crypto logic independent of DSH services and Microsoft transport
- Preserve the existing public Microsoft application ID; changing it requires maintainer approval
- Never increment or otherwise change the package version after edits, tests, builds, or packaging unless the user explicitly requests a version change; keep version references unchanged by default
- Never log tokens, passphrases, recovery keys, signed download URLs, or asset bodies; keep OAuth records in DSH credentials, not configuration or synced assets
- Never apply downloaded declarations as automatic installation instructions
- Use explicit, fingerprint-bound conflict choices and bounded backups, not timestamps to select a winner
- Treat encryption enablement as a protocol transition that must not race a plaintext writer
- Update protocol documentation and regression tests for persistent-format changes
- Install into a DSH profile only through the plugin manager and with explicit approval
- Keep local exploration and one-off acceptance results out of project documentation and version control; report actual checks and live-test gaps in the change description
