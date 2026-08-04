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
        assert.equal(payload.options.data.department, "운영");
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

  await loadClient(fakeClient).signUp({ loginId: "Rujina", name: "최성호", department: "운영", password: "123456" });

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
    () => loadClient(fakeClient).signUp({ loginId: "kim", name: "김민수", department: "개발", password: "123456" }),
    /Supabase SQL 업데이트/
  );
});