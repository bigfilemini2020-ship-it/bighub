# BigHub Supabase setup

1. Supabase SQL Editor에서 `supabase-schema.sql` 전체 실행.
2. Authentication > Sign In / Providers > Email에서 email confirmation을 MVP 동안 끄기.
3. Authentication > Users에서 관리자 계정 생성.
   - Email: `admin@bighub.local`
   - Password: 원하는 관리자 비밀번호
   - Auto Confirm User: 켜기
4. SQL Editor에서 `supabase-schema.sql` 맨 아래 admin profile seed 블록을 다시 실행.
5. Project Settings > API에서 값 복사.
   - Project URL -> `supabase-config.js`의 `supabaseUrl`
   - anon public key -> `supabase-config.js`의 `supabaseAnonKey`
6. `supabase-config.js`에는 service_role key를 절대 넣지 않기.

로그인 방식:

```text
사용자 입력: kim / password
내부 Auth: kim@bighub.local / password
```