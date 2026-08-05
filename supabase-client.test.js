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
  vm.runInNewContext(readFileSync("supabase-client.js", "utf8"), { window });
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
  };

  await assert.rejects(
    () => loadClient(fakeClient).deletePost("post-1"),
    /Supabase SQL|posts/
  );
});
