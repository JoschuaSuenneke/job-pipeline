# Connecting your mailbox

Mail sync reads replies to your applications: confirmations, rejections, interview invites, and "your move" requests such as tests or missing documents. It links each message to a job and updates the job's status. Connecting mail is optional.

**What job-pipeline does with mail**
- **Reads** your inbox and sent folder. Your own sent mail is never treated as a reply.
- **Files** confirmations into a folder (default "Job Pipeline"), only if you turn on `mail.fileConfirmations`.
- **Creates drafts**, only if your agent asks to and your config allows it.
- **Never sends mail.** There is no send function; you send drafts yourself.

Run `job-pipeline mail setup` and pick one of the three options below.

## IMAP with an app password (recommended)

IMAP works with almost every mailbox, and it needs only an app password.

| Service | How to get an app password |
|---|---|
| Gmail | Turn on 2-step verification, then Google Account → Security → App passwords |
| Outlook.com / Hotmail | Microsoft account → Security → Advanced security options → App passwords |
| GMX, WEB.DE | Settings → POP3/IMAP: allow IMAP; use your password or an app-specific password |
| iCloud | appleid.apple.com → Sign-In and Security → App-Specific Passwords |
| Company mail | Ask IT for IMAP access, or use the Outlook option below |

During setup, choose a preset (gmail, outlook, gmx, webde, icloud) or `custom`, then paste the app password. It's stored in `<workspace>/secrets` with mode `0600`. On macOS, set `JOB_PIPELINE_KEYCHAIN=1` to store it in the Keychain instead.

## Gmail API with your own OAuth client {#gmail}

Gmail's read scopes count as "restricted". A shared public OAuth app would need Google's paid security assessment, so each user brings their own client from their own Google Cloud project. It takes about 10 minutes.

1. Open console.cloud.google.com, create a project, and enable the **Gmail API**.
2. **OAuth consent screen**: user type *External*, publishing status *Testing*. Add your own address as a test user.
3. **Credentials → Create credentials → OAuth client ID**: application type **Desktop app**.
4. Run `job-pipeline mail setup`, choose `gmail`, and paste the client ID and secret. A browser opens. Approve access, and the redirect lands on a one-time local page.

Scopes requested: `gmail.readonly`. If you turn on filing, `gmail.modify` replaces it. If drafts are allowed, `gmail.compose` is added as well.

Note: in *Testing* mode, Google expires refresh tokens after 7 days. If sync stops, re-run the setup, or publish the app for your own use.

## Outlook / Microsoft 365 with your own Entra app {#outlook}

1. Open entra.microsoft.com, then **App registrations → New registration**.
   - Supported accounts: *Personal Microsoft accounts* for outlook.com, or *Accounts in this organizational directory* for work mail.
   - No redirect URI is needed.
2. **Authentication**: set **Allow public client flows** to *Yes*. This enables device-code sign-in.
3. **API permissions → Microsoft Graph → Delegated**: `Mail.Read`, `User.Read`, `offline_access`. Add `Mail.ReadWrite` only if you want filing or drafts.
4. Run `job-pipeline mail setup`, choose `microsoft`, paste the Application (client) ID, and pick the tenant: `consumers` for outlook.com, `organizations` or your tenant ID for work mail. Then enter the code shown at microsoft.com/link.

## Troubleshooting

- `job-pipeline doctor` checks the connection and tells you which step failed.
- **Wrong status after sync:** correct it in the dashboard. Every automatic change is in the activity log with the mail that caused it.
- **Disconnect:** delete the provider's files in `<workspace>/secrets`, then revoke access in your Google or Microsoft account.
