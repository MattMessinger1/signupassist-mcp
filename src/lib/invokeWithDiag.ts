import { supabase } from '@/integrations/supabase/client';

export async function invokeWithDiag<T = any>(
  functionName: string,
  payload: unknown
): Promise<{ ok: boolean; status: number; json: T | null; text: string; requestId?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const url = `${(supabase as any).functions.url}/${functionName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': token ? `Bearer ${token}` : '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload ?? {}),
  });

  const requestId =
    res.headers.get('x-supabase-request-id') ||
    res.headers.get('x-request-id') ||
    undefined;

  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }

  if (!res.ok) {
    console.error(`[invokeWithDiag] ${functionName} failed`, {
      status: res.status, requestId, text: json ?? text, payload,
    });
  } else {
    console.log(`[invokeWithDiag] ${functionName} ok`, { status: res.status, requestId, json });
  }

  return { ok: res.ok, status: res.status, json, text, requestId };
}
