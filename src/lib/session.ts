// Autosave of the last session: settings + focus in localStorage, the image in
// IndexedDB (localStorage only holds ~5MB of text, too small for most photos).
// Every call swallows storage errors: losing the autosave must never break the app.
import type { Focus } from "./engine";
import { sanitizeParams, VIEW_KEYS, type Params } from "./params";

const KEY = "focal-dither:session";
const DB = "focal-dither";
const STORE = "files";
const IMAGE = "last-image";

export type Session = { params: Params; focus: Focus };

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const params = sanitizeParams(data?.params);
    // sanitizeParams drops view keys (presets don't carry them); a session does
    for (const k of VIEW_KEYS) if (typeof data?.params?.[k] === "boolean") params[k] = data.params[k];
    const f = data?.focus;
    const focus = f && Number.isFinite(f.x) && Number.isFinite(f.y)
      ? { x: Math.min(1, Math.max(0, f.x)), y: Math.min(1, Math.max(0, f.y)) }
      : { x: 0.5, y: 0.5 };
    return { params, focus };
  } catch { return null; }
}

export function saveSession(s: Session) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* full or blocked */ }
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  try {
    const d = await db();
    return await new Promise<T | null>((resolve, reject) => {
      const req = run(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => { resolve(req.result ?? null); d.close(); };
      req.onerror = () => { reject(req.error); d.close(); };
    });
  } catch { return null; }
}

export const loadImage = () => tx<Blob>("readonly", s => s.get(IMAGE));
export const saveImage = (b: Blob) => tx("readwrite", s => s.put(b, IMAGE));
