# Security

job-pipeline runs locally. Your database, facts, CVs and mail tokens live in your workspace (`~/.job-pipeline` by default), never in this repository.

- Mail credentials and OAuth tokens are stored with `0600` permissions in `<workspace>/secrets`, or in the macOS Keychain when available.
- The dashboard binds to `127.0.0.1` and rejects cross-origin writes.
- Mail access is read-only unless you opt in to filing or drafts. job-pipeline has no function that sends mail; drafts are the furthest it goes.

Please report vulnerabilities privately through GitHub Security Advisories, not in a public issue.
