// window.storage polyfill for standalone deployment.
//
// Inside Claude's own preview, window.storage is provided automatically
// and data is stored on Anthropic's servers. Once this app is deployed
// on its own (Vercel, Netlify, etc.), that API does not exist -- so this
// file recreates the same get/set/delete/list shape using the browser's
// localStorage instead.
//
// IMPORTANT LIMITATION: localStorage is per-device, per-browser. Data
// saved in the Staff Admin Panel on your laptop will NOT appear on a
// patient's phone -- each device has its own separate storage. This is
// fine for testing solo, but before real patients use this app, replace
// this file with calls to a real shared database (see DEPLOYMENT.md,
// "Replace the storage layer").

function keyFor(key, shared) {
  // "shared" doesn't mean anything for localStorage (it's always
  // local-only), but we keep the same key shape for compatibility.
  return "ahg-storage:" + (shared ? "shared:" : "personal:") + key;
}

if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key, shared = false) {
      const raw = localStorage.getItem(keyFor(key, shared));
      if (raw === null) throw new Error("Key not found: " + key);
      return { key, value: raw, shared };
    },
    async set(key, value, shared = false) {
      localStorage.setItem(keyFor(key, shared), value);
      return { key, value, shared };
    },
    async delete(key, shared = false) {
      localStorage.removeItem(keyFor(key, shared));
      return { key, deleted: true, shared };
    },
    async list(prefix = "", shared = false) {
      const marker = keyFor(prefix, shared);
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(marker)) keys.push(k.replace(keyFor("", shared), ""));
      }
      return { keys, prefix, shared };
    },
  };
}
