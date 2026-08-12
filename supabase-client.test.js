const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function loadClient(fakeClient = {}, fetchImpl = fetch) {
  const window = {
    BigHubConfig: { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public" },
    EducationState: {
      validateLoginId(value) { return String(value).trim().toLowerCase(); },
      loginIdToAuthEmail(value) { return String(value).trim().toLowerCase() + "@bighub.local"; },
    },
    supabase: { createClient: () => fakeClient },
    fetch: fetchImpl,
  };
  vm.runInNewContext(readFileSync("supabase-client.js", "utf8"), { window, fetch: fetchImpl, setTimeout, URL });
  return window.BigHubSupabase;
}

test("signUp creates a temporary signup request instead of an Auth user", async () => {
  let calledAuthSignup = false;
  let requestBody = null;
  const fakeClient = { auth: { signUp: async () => { calledAuthSignup = true; return { data: {}, error: null }; } } };
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://example.supabase.co/functions/v1/request-signup");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.apikey, "public");
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ ok: true }) };
  };

  await loadClient(fakeClient, fetchImpl).signUp({ loginId: "Rujina", name: "user", department: "ops", password: "123456", passwordConfirm: "123456" });

  assert.equal(calledAuthSignup, false);
  assert.deepEqual(requestBody, { loginId: "rujina", name: "user", department: "ops", password: "123456", passwordConfirm: "123456" });
});

test("signUp reports duplicate signup request messages from the function", async () => {
  const fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ error: "이미 가입 신청된 아이디입니다." }) });

  await assert.rejects(
    () => loadClient({}, fetchImpl).signUp({ loginId: "rujina", name: "user", department: "ops", password: "123456", passwordConfirm: "123456" }),
    (error) => error.status === 409 && /이미 가입되었거나 가입 신청 중인 아이디/.test(error.message)
  );
});

test("signUp rejects mismatched password confirmation before requesting signup", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, json: async () => ({ ok: true }) };
  };

  await assert.rejects(
    () => loadClient({}, fetchImpl).signUp({ loginId: "rujina", name: "user", department: "ops", password: "123456", passwordConfirm: "654321" }),
    /비밀번호 확인이 일치하지 않습니다/
  );
  assert.equal(called, false);
});

test("listSignupRequests reads pending temporary requests", async () => {
  const rows = [{ id: "req-1", login_id: "kim", name: "김", department: "운영", status: "pending", created_at: "now" }];
  const fakeClient = {
    from(table) {
      assert.equal(table, "signup_requests");
      return { select: () => ({ eq: () => ({ order: async () => ({ data: rows, error: null }) }) }) };
    },
  };

  const requests = await loadClient(fakeClient).listSignupRequests();

  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ id: "req-1", loginId: "kim", name: "김", department: "운영", status: "pending", createdAt: "now" }]);
});

test("approveProfile calls approve-signup function", async () => {
  let body = null;
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://example.supabase.co/functions/v1/approve-signup");
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ ok: true }) };
  };

  await loadClient({ auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) } }, fetchImpl).approveProfile("req-1");

  assert.deepEqual(body, { requestId: "req-1" });
});

test("rejectProfile calls reject-signup function", async () => {
  let body = null;
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://example.supabase.co/functions/v1/reject-signup");
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ ok: true }) };
  };

  await loadClient({ auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) } }, fetchImpl).rejectProfile("req-1");

  assert.deepEqual(body, { requestId: "req-1" });
});

test("signIn translates profile permission errors in Korean", async () => {
  const fakeClient = {
    auth: {
      signInWithPassword: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
    from() {
      return {
        select: () => ({
          eq: () => ({ single: async () => ({ data: null, error: new Error("permission denied for table profiles") }) }),
        }),
      };
    },
  };

  await assert.rejects(
    () => loadClient(fakeClient).signIn({ loginId: "rujina", password: "123456", passwordConfirm: "123456" }),
    /가입\/로그인 정보 저장 권한/
  );
});

test("signIn translates invalid credentials in Korean", async () => {
  const fakeClient = {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: new Error("Invalid login credentials") }),
    },
  };

  await assert.rejects(
    () => loadClient(fakeClient).signIn({ loginId: "rujina", password: "bad" }),
    /아이디 또는 비밀번호/
  );
});
test("signIn reports pending approval when the id has a waiting request", async () => {
  const calls = [];
  const fakeClient = {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: new Error("Invalid login credentials") }),
    },
    rpc: async (name, args) => {
      calls.push([name, args]);
      return { data: true, error: null };
    },
  };

  await assert.rejects(
    () => loadClient(fakeClient).signIn({ loginId: "Rujina", password: "bad" }),
    /관리자 승인 대기 중입니다/
  );
  // Compared field by field: the client runs in a vm context, so its object
  // literals fail deepStrictEqual's prototype check.
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "signup_is_pending");
  assert.equal(calls[0][1].login_id_input, "rujina");
});

test("deletePost verifies that a row was actually deleted", async () => {
  let selected = false;
  const fakeClient = {
    from(table) {
      assert.equal(table, "posts");
      return {
        delete: () => ({
          eq: (column, value) => {
            assert.equal(column, "id");
            assert.equal(value, "post-1");
            return {
              select: async (fields) => {
                selected = true;
                assert.equal(fields, "id");
                return { data: [{ id: "post-1" }], error: null };
              },
            };
          },
        }),
      };
    },
  };

  await loadClient(fakeClient).deletePost("post-1");
  assert.equal(selected, true);
});

test("deletePost falls back to admin RPC when RLS hides deleted rows", async () => {
  let rpcCalled = false;
  const fakeClient = {
    from() {
      return {
        delete: () => ({
          eq: () => ({
            select: async () => ({ data: [], error: null }),
          }),
        }),
      };
    },
    rpc(name, payload) {
      rpcCalled = true;
      assert.equal(name, "delete_post");
      assert.equal(payload.post_id_input, "post-1");
      return { data: true, error: null };
    },
  };

  await loadClient(fakeClient).deletePost("post-1");
  assert.equal(rpcCalled, true);
});

test("deletePost reports zero deleted rows as a permission problem", async () => {
  const fakeClient = {
    from() {
      return {
        delete: () => ({
          eq: () => ({
            select: async () => ({ data: [], error: null }),
          }),
        }),
      };
    },
    rpc: async () => ({ data: false, error: null }),
  };

  await assert.rejects(
    () => loadClient(fakeClient).deletePost("post-1"),
    /delete_post|삭제 권한/
  );
});

test("addComment retries transient fetch failures", async () => {
  let attempts = 0;
  const fakeClient = {
    from(table) {
      assert.equal(table, "comments");
      return {
        insert: async (row) => {
          attempts += 1;
          assert.equal(row.post_id, "post-1");
          if (attempts === 1) throw new TypeError("Failed to fetch");
          return { error: null };
        },
      };
    },
  };

  await loadClient(fakeClient).addComment({ postId: "post-1", userId: "user-1", body: "test" });
  assert.equal(attempts, 2);
});

test("addComment translates repeated fetch failures", async () => {
  const fakeClient = {
    from() {
      return {
        insert: async () => { throw new TypeError("Failed to fetch"); },
      };
    },
  };

  await assert.rejects(
    () => loadClient(fakeClient).addComment({ postId: "post-1", userId: "user-1", body: "test" }),
    /네트워크 연결이 불안정/
  );
});
