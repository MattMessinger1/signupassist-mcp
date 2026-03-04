import test from 'node:test';
import assert from 'node:assert/strict';

type Row = Record<string, any>;

function makeSupabaseMock() {
  const db = {
    children: [] as Row[],
    delegate_profiles: [] as Row[]
  };

  const makeQuery = (table: 'children' | 'delegate_profiles') => {
    const state: any = { table, filters: [] as Array<[string, any]>, action: 'select', payload: null };
    const query: any = {
      select: () => {
        state.action = state.action === 'insert' || state.action === 'update' || state.action === 'upsert' ? state.action : 'select';
        return query;
      },
      eq: (k: string, v: any) => {
        state.filters.push([k, v]);
        return query;
      },
      order: () => query,
      insert: (payload: Row) => {
        state.action = 'insert';
        state.payload = payload;
        return query;
      },
      update: (payload: Row) => {
        state.action = 'update';
        state.payload = payload;
        return query;
      },
      upsert: (payload: Row) => {
        state.action = 'upsert';
        state.payload = payload;
        return query;
      },
      maybeSingle: async () => {
        let rows = db[table].filter((row) => state.filters.every(([k, v]: [string, any]) => row[k] === v));
        return { data: rows[0] ?? null, error: null };
      },
      single: async () => {
        if (state.action === 'insert') {
          const row = { id: `${table}-1`, created_at: new Date().toISOString(), ...state.payload };
          db[table].push(row);
          return { data: row, error: null };
        }
        if (state.action === 'update') {
          const idx = db[table].findIndex((row) => state.filters.every(([k, v]: [string, any]) => row[k] === v));
          db[table][idx] = { ...db[table][idx], ...state.payload };
          return { data: db[table][idx], error: null };
        }
        if (state.action === 'upsert') {
          const idx = db[table].findIndex((row) => row.user_id === state.payload.user_id);
          if (idx >= 0) {
            db[table][idx] = { ...db[table][idx], ...state.payload };
            return { data: db[table][idx], error: null };
          }
          const row = { id: `${table}-1`, created_at: new Date().toISOString(), ...state.payload };
          db[table].push(row);
          return { data: row, error: null };
        }
        return { data: null, error: null };
      },
      then: undefined,
      [Symbol.asyncIterator]: undefined
    };
    return query;
  };

  return {
    db,
    client: {
      from: (table: 'children' | 'delegate_profiles') => {
        const q = makeQuery(table);
        const arrPromise: any = Promise.resolve({
          data: db[table],
          error: null
        });
        q.order = () => arrPromise;
        return q;
      }
    }
  };
}

test('user provider encrypts on write and decrypts on read', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
  process.env.PII_ENCRYPTION_KEY_ID = 'v1';
  process.env.PII_ENCRYPTION_KEYRING_JSON = JSON.stringify({});

  const userProvider = await import('../providers/user.js');
  const mock = makeSupabaseMock();
  userProvider.__setSupabaseClientForTests(mock.client);

  const createRes = await userProvider.createChild({
    user_id: 'user-1',
    first_name: 'Alice',
    last_name: 'Smith',
    dob: '2015-05-15'
  });

  assert.equal(createRes.success, true);
  assert.equal(mock.db.children[0].first_name, null);
  assert.equal(typeof mock.db.children[0].first_name_encrypted, 'object');
  assert.equal(createRes.data?.child.first_name, 'Alice');

  const listRes = await userProvider.listChildren({ user_id: 'user-1' });
  assert.equal(listRes.success, true);
  assert.equal(listRes.data?.children[0].last_name, 'Smith');

  const updateRes = await userProvider.updateDelegateProfile({
    user_id: 'user-1',
    first_name: 'Pat',
    last_name: 'Guardian',
    phone: '+15555551212',
    email: 'pat@example.com',
    date_of_birth: '1985-07-01'
  });
  assert.equal(updateRes.success, true);
  assert.equal(mock.db.delegate_profiles[0].phone, null);
  assert.equal(typeof mock.db.delegate_profiles[0].phone_encrypted, 'object');

  const profileRes = await userProvider.getDelegateProfile({ user_id: 'user-1' });
  assert.equal(profileRes.success, true);
  assert.equal(profileRes.data?.profile?.first_name, 'Pat');
  assert.equal(profileRes.data?.profile?.phone, '+15555551212');
});
