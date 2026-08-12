# BigHub Supabase Edge Functions

Functions in this folder:

- `request-signup`: saves a temporary signup request. It does not create an Auth user.
- `approve-signup`: admin-only. Creates the Supabase Auth user, creates/updates the approved profile, then marks the request approved.
- `reject-signup`: admin-only. Marks the request rejected and removes the encrypted password payload.
- `drive-upload` / `drive-download`: Google Drive file upload/download bridge.

Required Supabase Function secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BIGHUB_SIGNUP_SECRET`: long random string used to encrypt pending signup passwords until approval.
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID`

Deploy after SQL schema update:

```powershell
supabase functions deploy request-signup
supabase functions deploy approve-signup
supabase functions deploy reject-signup
supabase functions deploy drive-upload
supabase functions deploy drive-download
```

Do not commit real secret values.
