# BigHub Supabase setup

1. Supabase SQL Editor에서 `supabase-schema.sql` 전체를 실행한다.
   - 가입 신청용 profile 자동 생성 trigger가 포함되어 있다.
   - 기존에 Auth만 생성되고 profile이 빠진 사용자도 복구한다.
2. Authentication > Sign In / Providers > Email에서 `Confirm email`을 끈다.
3. Authentication > Users에서 관리자 계정을 만든다.
   - Email: `admin@bighub.local`
   - Password: 원하는 관리자 비밀번호
   - Auto Confirm User: 켜기
4. SQL Editor에서 `supabase-schema.sql` 전체를 다시 실행한다.
   - 마지막 admin seed가 관리자 profile을 승인 상태로 만든다.
5. Project Settings > API에서 값을 복사해 `supabase-config.js`에 넣는다.
   - Project URL -> `supabaseUrl`
   - Publishable key 또는 anon public key -> `supabaseAnonKey`
6. `service_role` secret key는 브라우저 코드나 GitHub에 넣지 않는다.

로그인 방식:

```text
사용자 입력: kim / password
내부 Auth: kim@bighub.local / password
```

가입 신청 흐름:

```text
사용자가 가입 신청
-> Supabase Auth user 생성
-> DB trigger가 profiles에 pending profile 자동 생성
-> 관리자가 BigHub의 가입 승인 메뉴에서 승인
-> 사용자가 로그인 가능
```