export type ApiState = {
  tasks: any[];
  employees: string[];
  vehicles: string[];
  contacts: { id: string; name: string; phone?: string }[];
  admins?: string[];
};

export type ApiEvent = {
  entity: 'tasks' | 'employees' | 'vehicles' | 'contacts' | 'admins' | 'auth';
  action:
    | 'upsert'
    | 'delete'
    | 'import'
    | 'login'
    | 'logout'
    | 'bootstrap';
  payload: any;
  clientId?: string;
};

const DEFAULT_GAS_URL =
  'https://script.google.com/macros/s/AKfycbxQMHx8YRSomcNyRll6q1aCAT2bQsRjXEuL5Ap2iP7N_8Oaq0yfvLpki4BZGwd5cp7sSQ/exec';

const GAS_URL_LS_KEY = 'workflow.gasUrl.v1';

export function getGasUrl(): string {
  try {
    const fromLs = localStorage.getItem(GAS_URL_LS_KEY);
    if (fromLs && fromLs.trim()) return fromLs.trim();
  } catch {
    // ignore
  }
  const fromEnv = (import.meta as any)?.env?.VITE_GAS_URL as string | undefined;
  return fromEnv?.trim() || DEFAULT_GAS_URL;
}

export function setGasUrl(nextUrl: string) {
  const url = String(nextUrl || '').trim();
  try {
    if (!url) localStorage.removeItem(GAS_URL_LS_KEY);
    else localStorage.setItem(GAS_URL_LS_KEY, url);
  } catch {
    // ignore
  }
}

function gasUrl() {
  return getGasUrl();
}

function jsonp<T>(url: string, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const cb = `__jsonp_cb_${Math.random().toString(36).slice(2)}`;
    let settled = false;
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('JSONP timeout (web app may require access or callback not executed)'));
    }, timeoutMs);

    const cleanup = () => {
      settled = true;
      window.clearTimeout(timer);
      try {
        delete (window as any)[cb];
      } catch {
        // ignore
      }
      script.remove();
    };

    const script = document.createElement('script');
    (window as any)[cb] = (data: T) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('JSONP error (script failed to load)'));
    };
    // Cache-bust to reduce stale/cached HTML responses
    const bust = `_=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    script.src = `${url}${url.includes('?') ? '&' : '?'}callback=${encodeURIComponent(cb)}&${bust}`;
    script.onload = () => {
      // If the script loads but callback never fires (HTML/login page), fail fast-ish.
      window.setTimeout(() => {
        if (!settled) {
          cleanup();
          reject(new Error('JSONP loaded but callback not called (check Web App access / deployment)'));
        }
      }, 300);
    };
    document.head.appendChild(script);
  });
}

export async function apiGetState(signal?: AbortSignal): Promise<ApiState> {
  const url = gasUrl();
  if (!url) throw new Error('Missing VITE_GAS_URL');
  if (signal?.aborted) throw new Error('Aborted');
  const stateUrl = `${url}?action=state`;
  // Prefer normal fetch (works when GAS returns JSON)
  try {
    const res = await fetch(stateUrl, { signal, mode: 'cors' });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return (await res.json()) as ApiState;
  } catch (e) {
    // Fallback to JSONP when CORS blocks fetch
    return await jsonp<ApiState>(stateUrl);
  }
}

export async function apiAppendEvent(event: ApiEvent): Promise<void> {
  const url = gasUrl();
  if (!url) throw new Error('Missing VITE_GAS_URL');
  const payload = JSON.stringify({ action: 'event', event });

  // Prefer sendBeacon (no CORS issues, fire-and-forget)
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const ok = navigator.sendBeacon(url, new Blob([payload], { type: 'text/plain;charset=utf-8' }));
    if (ok) return;
  }

  // Fallback: no-cors POST (response not readable, but request is sent)
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    body: payload,
  });
}

export async function apiLogin(username: string, password: string): Promise<{ ok: boolean; username?: string }> {
  const url = gasUrl();
  if (!url) throw new Error('Missing VITE_GAS_URL');
  const u = encodeURIComponent(username);
  const p = encodeURIComponent(password);
  const loginUrl = `${url}?action=login&u=${u}&p=${p}`;
  try {
    const res = await fetch(loginUrl, { mode: 'cors' });
    // If endpoint isn't deployed yet, treat as "not ok" instead of connection error
    if (!res.ok) {
      try {
        const body = (await res.json()) as any;
        return { ok: Boolean(body?.ok), username: body?.username };
      } catch {
        return { ok: false };
      }
    }
    return (await res.json()) as { ok: boolean; username?: string };
  } catch {
    // Network/CORS fallback
    try {
      return await jsonp<{ ok: boolean; username?: string }>(loginUrl);
    } catch {
      return { ok: false };
    }
  }
}

