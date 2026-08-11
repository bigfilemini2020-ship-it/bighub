const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function loadClient(fakeClient) {
  const window = {
    BigHubConfig: { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public" },
    EducationState: {
      validateLoginId(value) { return String(value).trim().toLowerCase(); },
      loginIdToAuthEmail(value) { return `${String(value).trim().toLowerCase()}@bighub.local`; },
    },
    supabase: { createClient: () => fakeClient },
  };
  vm.runInNewContext(readFileSync("supabase-client.js", "utf8"), { window, setTimeout });
  return window.BigHubSupabase;
}

test("signUp waits for trigger-created pending profile", async () => {
  let signedOut = false;
  let selectedTable = "";
  const fakeClient = {
    auth: {
      signUp: async (payload) => {
        assert.equal(payload.email, "rujina@bighub.local");
        assert.equal(payload.options.data.department, "ops");
        return { data: { user: { id: "user-1" } }, error: null };
      },
      signOut: async () => { signedOut = true; },
    },
    from(table) {
      selectedTable = table;
      return {
        select: () => ({
          eq: (_column, value) => ({
            maybeSingle: async () => ({ data: { id: value, status: "pending" }, error: null }),
          }),
        }),
      };
    },
  };

  await loadClient(fakeClient).signUp({ loginId: "Rujina", name: "user", department: "ops", password: "123456" });

  assert.equal(selectedTable, "profiles");
  assert.equal(signedOut, true);
});

test("signUp reports missing profile trigger setup", async () => {
  const fakeClient = {
    auth: {
      signUp: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      signOut: async () => {},
    },
    from() {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      };
    },
  };

  await assert.rejects(
    () => loadClient(fakeClient).signUp({ loginId: "kim", name: "user", department: "dev", password: "123456" }),
    /Supabase SQL/
  );
});

test("signUp explains already registered login ids in Korean", async () => {
  const fakeClient = {
    auth: {
      signUp: async () => ({ data: {}, error: new Error("User already registered") }),
    },
  };

  await assert.rejects(
    () => loadClient(fakeClient).signUp({ loginId: "rujina", name: "user", department: "ops", password: "123456" }),
    /이미 가입 신청된 아이디/
  );
});


test("signUp reopens rejected existing accounts", async () => {
  let signedOut = false;
  let updatePayload = null;
  let selectedProfileId = "";
  const fakeClient = {
    auth: {
      signUp: async () => ({ data: {}, error: new Error("User already registered") }),
      signInWithPassword: async (payload) => {
        assert.equal(payload.email, "jang8189@bighub.local");
        assert.equal(payload.password, "pass1234");
        return { data: { user: { id: "user-1" } }, error: null };
      },
      signOut: async () => { signedOut = true; },
    },
    from(table) {
      assert.equal(table, "profiles");
      return {
        select: () => ({
          eq: (_column, value) => ({
            maybeSingle: async () => ({ data: { id: value, status: "rejected" }, error: null }),
          }),
        }),
        update(payload) {
          updatePayload = payload;
          return {
            eq(column, value) {
              assert.equal(column, "id");
              selectedProfileId = value;
              return { error: null };
            },
          };
        },
      };
    },
  };

  await loadClient(fakeClient).signUp({ loginId: "jang8189", name: "장재민", department: "운영", password: "pass1234" });

  assert.equal(updatePayload.status, "pending");
  assert.equal(updatePayload.login_id, "jang8189");
  assert.equal(updatePayload.name, "장재민");
  assert.equal(updatePayload.department, "운영");
  assert.equal(selectedProfileId, "user-1");
  assert.equal(signedOut, true);
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
    () => loadClient(fakeClient).signIn({ loginId: "rujina", password: "123456" }),
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
test("rejectProfile marks a pending profile as rejected", async () => {
  let updatePayload = null;
  let eqArgs = null;
  const fakeClient = {
    from(table) {
      assert.equal(table, "profiles");
      return {
        update(payload) {
          updatePayload = payload;
          return {
            eq(column, value) {
              eqArgs = [column, value];
              return { error: null };
            },
          };
        },
      };
    },
  };

  await loadClient(fakeClient).rejectProfile("user-1");

  assert.equal(updatePayload.status, "rejected");
  assert.deepEqual(eqArgs, ["id", "user-1"]);
});
