# BigHub Supabase setup

1. In Supabase SQL Editor, run `supabase-schema.sql`.
2. Authentication > Sign In / Providers > Email: turn off email confirmation for this MVP.
3. Authentication > Users: create the admin user.
   - Email: `admin@bighub.local`
   - Password: your admin password
   - Auto Confirm User: on
4. Run `supabase-schema.sql` again so the final admin seed block creates/updates the admin profile.
5. Project Settings > API: copy values into `supabase-config.js`.
   - Project URL -> `supabaseUrl`
   - anon/public key -> `supabaseAnonKey`
6. Edge Function secrets: set every value listed in `supabase/functions/README.md`.
7. Deploy Edge Functions listed in `supabase/functions/README.md`.

Signup flow:

```text
User submits signup request
-> request-signup saves row in signup_requests only
-> Admin sees pending signup_requests in BigHub
-> Admin approve creates Supabase Auth user and approved profile
-> Admin reject marks request rejected and clears encrypted password data
-> Rejected login_id can submit a fresh request again
```

The old direct pending-profile signup flow is disabled. `profiles` should represent real users, not temporary signup requests.
