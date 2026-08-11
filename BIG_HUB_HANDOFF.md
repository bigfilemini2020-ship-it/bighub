# BigHub Handoff

## Current request

Continue **Mux direct video upload and streaming only**. Do not reopen or redo Google Drive, Google OAuth, service account, Vercel, installer version, or unrelated UI work unless a concrete blocker requires it.

## Required architecture

- Video: BigHub desktop app -> Mux direct upload -> Mux playback in feed.
- PDF, image, HTML, and other documents: existing Google Drive route.
- Login, posts, comments, permissions: Supabase.
- Never route video bytes through Vercel. Vercel was paused after bandwidth overage and must not be used for media.

## User constraints

- User is frustrated by repeated failed Google Drive/OAuth attempts. **Do not ask them to repeat Drive/OAuth/service-account steps.**
- Do not claim completion before one real video upload and playback succeeds.
- Do not bump installer/app version until Mux flow works end-to-end.
- Keep user actions minimal. Explain exact input/location before requesting credentials or clicks.
- Never place Mux secret in client code, Git, logs, or chat.

## Workspace

`C:\Users\User\.codex\visualizations\2026\08\04\019fca3c-86a1-7dd1-a97a-f6c6326b3ef1`

Useful files:

- `app.js`: existing client upload and feed behavior.
- `supabase/functions/_shared/mux.ts`: Mux API helper and signing support.
- `supabase/functions/mux-create-upload/index.ts`
- `supabase/functions/mux-upload-status/index.ts`
- `supabase/functions/mux-playback-token/index.ts`
- `mux-video-upload.test.js`: expected client wiring.
- `supabase-schema.sql`: existing DB/RLS schema. Do not rerun whole schema unless a specific error proves it is required.

## Existing Mux setup

- Mux Video API token was created with Read + Write.
- User says Mux billing is enabled; exact plan is unknown.
- User downloaded Mux token and signing-key files into `C:\Users\User\Downloads`.
- User approved storing Mux secrets in the BigHub Supabase project.
- Supabase project ref: `kxorrekxpwkpggvdgwru`.
- Supabase CLI login was confirmed.
- Existing edge-function helper expects secrets named:
  - `MUX_TOKEN_ID`
  - `MUX_TOKEN_SECRET`
  - `MUX_SIGNING_KEY_ID`
  - `MUX_SIGNING_PRIVATE_KEY`

## Work still required

1. Verify Mux secrets are actually present in Supabase, without printing values.
2. Deploy Mux edge functions and verify each endpoint returns expected errors/success.
3. Wire only video files in `app.js` to `mux-create-upload`; keep non-video Drive flow untouched.
4. Store Mux attachment metadata: provider `mux`, upload ID, file name, MIME type.
5. Poll upload/asset status after upload; show processing state until playable.
6. Render Mux playback correctly in Tauri Windows WebView. Native HLS may not work; use Mux Player or a tested compatible player if needed.
7. Test one real short video: choose file -> upload -> processing -> playback -> reload feed -> playback again.

## Important technical checks

- `mux-create-upload` currently validates an HTTP/HTTPS origin. Tauri uses a `tauri.localhost` runtime origin; verify this is accepted before testing.
- Check `src-tauri/tauri.conf.json` CSP/network permissions for Mux upload and playback hosts.
- Mux API secrets must remain edge-function-only. Client receives only direct-upload URL and non-secret playback identifier/token.
- Signed playback must be tested in the installed desktop app, not only browser.

## Existing non-Mux defects (do not expand scope now)

- Selecting a file, then selecting another separately, overwrites the first selection. Desired behavior: append selections; each file removable before submit.
- Drive upload/profile/post permission errors occurred intermittently.
- Drive image preview sometimes renders broken.
- Comments, notifications, updater, and desktop settings have unresolved behavior.

## Verification standard

Do not say Mux is done until all are true:

1. Supabase edge function creates direct upload URL.
2. Desktop app uploads a real video to Mux.
3. Mux asset becomes ready.
4. Feed plays the video in installed Tauri app.
5. PDF/image upload still follows Drive route.
6. No Mux secret appears in browser/desktop source, Git, or user-facing error.

## Deployment note

Vercel is not part of media transport. Current web deployment is paused because its bandwidth quota was exceeded. This does not block Supabase, Mux, Drive, or local desktop testing, but do not depend on Vercel for runtime media.
