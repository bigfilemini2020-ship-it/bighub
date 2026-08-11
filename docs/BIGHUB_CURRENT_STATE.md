# BigHub Current State

Updated: 2026-08-06

Read this file before any BigHub change. Update only after checking source, deployed state, or a reproduced error.

## Product Direction

- BigHub is an internal desktop communication app.
- Posts: notice, general, question, mission.
- Video: YouTube links embedded in feed. Do not proxy or host video through Vercel.
- Attachments and images: Google Drive.
- Data and login: Supabase.
- Desktop app: Tauri for Windows.
- Testing updates: manual installer install.
- Production updates: GitHub Releases updater later. Do not bump version per small change; collect fixes, confirm, then release one version.

## Verified Facts

### Vercel

- Vercel project is paused after Fast Origin Transfer exceeded free-plan allowance.
- Vercel is not a reliable current runtime for BigHub web/API traffic.
- Vercel must not serve, proxy, or stream Google Drive video/files.
- A Vercel deployment being `Ready` does not mean paused project traffic is available.

### Google Drive

- Upload folder ID: `1h8SyCn0hfRV9os_D1DG6pct_FZ2RSaAw`.
- Folder owner account: `bigfilemini2020@gmail.com`.
- Service-account upload to personal My Drive failed with `Service Accounts do not have storage quota`.
- Sharing a personal My Drive folder to a service account does not give that service account storage quota.
- Existing desktop code uses Google OAuth refresh-token flow, not service-account fallback.

### Desktop Upload Code

Current Tauri upload path expects all four values:

```text
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GOOGLE_DRIVE_FOLDER_ID
```

Source: `src-tauri/src/lib.rs`.

The installed desktop app does not inherit Vercel environment variables. It needs its own configuration at build time or runtime.

Windows user environment check showed all four variables were absent. They were not deleted from Windows; they had never been written there.

### OAuth State

- OAuth Playground now returns `401: deleted_client` for an old client ID.
- Cause of deletion is not verified. Do not claim a cause without Google Cloud audit evidence.
- Do not repeat OAuth Playground steps yet.

## Critical Decision Before Any More Google Work

Who is allowed to upload files?

1. **Admin only**: one trusted admin upload identity. Lowest implementation cost, but credentials must stay only on admin machine/server.
2. **All approved employees**: each uploader signs in with their own Google account. Requires user OAuth and Drive-sharing design.
3. **Company storage/server**: best company-control model. Requires internal server/storage support from development team.

Do not distribute one owner Google refresh token inside every employee desktop app. That exposes the owner Drive account.

## Current Blocking Issue

Desktop attachment uploads cannot be considered working until a new valid Google OAuth client is intentionally created and the upload-authority decision above is made.

The failed prior path mixed three incompatible models:

- Vercel environment variables
- service account upload to personal Drive
- desktop application direct upload

That was incorrect. Future work must choose one model first.

## Non-Negotiable Rules

- Never put OAuth client secret, refresh token, service-account JSON, Supabase secret key, or signing key in chat, Git, or public release files.
- Never route video/media through Vercel.
- Never ask user to redo OAuth setup before verifying exact missing configuration and selected upload model.
- Never claim a fix without a reproducible test in installed desktop app or source test.
- Do not build or release installer until user confirms version release scope.
- Do not tell user to delete/reset existing data or configuration without exact impact and confirmation.

## Next Work Order

1. Confirm upload authority: admin only, all approved employees, or company storage.
2. Design credential storage for that model.
3. Create/validate only required Google OAuth client once.
4. Test upload, multi-file upload, image render, file download from installed app.
5. Batch remaining fixes.
6. Ask user to approve version number, then create installer/release.

## Working Agreement

For each future BigHub request:

1. Read this file first.
2. State verified facts, unknowns, and risk before changing setup.
3. Make one scoped change.
4. Verify it.
5. Update this file with result.


## 2026-08-06 Drive ??? ??

- ?? ??: BigHub ? -> Supabase Edge Function -> bigfilemini2020@gmail.com ?? Google Drive
- ?? ??: Vercel API, Google ??? ??, ??? PC ???? ?? ?? ???
- ??: YouTube ??? ??
- ??: ??? 10MB
