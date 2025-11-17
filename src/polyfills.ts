// src/polyfills.ts
// Lightweight runtime polyfills to support older Node versions.
// Provides global fetch, AbortController, and crypto.randomUUID when missing.

export {};

void (async function applyPolyfills() {
  try {
    // Fetch + AbortController
    if (typeof (globalThis as any).fetch === 'undefined') {
      try {
        // prefer undici if available
        // @ts-ignore
        const undiciMod: any = await import('undici');
        const undici: any = undiciMod;
        (globalThis as any).fetch = undici.fetch ?? (globalThis as any).fetch;
        if (typeof (globalThis as any).AbortController === 'undefined' && undici.AbortController) {
          (globalThis as any).AbortController = undici.AbortController;
        }
        // eslint-disable-next-line no-console
        console.info('Polyfilled fetch/AbortController using undici');
      } catch {
        try {
          // @ts-ignore
          const nf: any = await import('node-fetch');
          const nodeFetch = nf?.default ?? nf;
          if (nodeFetch) (globalThis as any).fetch = nodeFetch;
          try {
            // @ts-ignore
            const abortMod: any = await import('abort-controller');
            (globalThis as any).AbortController = abortMod?.default ?? abortMod;
          } catch {}
          // eslint-disable-next-line no-console
          console.info('Polyfilled fetch using node-fetch');
        } catch {
          // eslint-disable-next-line no-console
          console.warn('No fetch polyfill available; fetch may be undefined');
        }
      }
    }

    // crypto.randomUUID
    try {
      // @ts-ignore
      const cryptoMod: any = await import('crypto');
      const nodeCrypto: any = cryptoMod;
      (globalThis as any).crypto = (globalThis as any).crypto || nodeCrypto;
      if (typeof (globalThis as any).crypto.randomUUID !== 'function') {
        (globalThis as any).crypto.randomUUID = function () {
          let bytes: Uint8Array;
          if (nodeCrypto && typeof nodeCrypto.randomBytes === 'function') {
            const rb = nodeCrypto.randomBytes(16);
            bytes = rb instanceof Uint8Array ? rb : new Uint8Array(rb);
          } else {
            const arr = new Uint8Array(16);
            for (let i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256);
            bytes = arr;
          }
          // Per RFC4122 v4: set version and variant bits
          bytes[6] = (bytes[6] & 0x0f) | 0x40;
          bytes[8] = (bytes[8] & 0x3f) | 0x80;
          const hex = Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
          return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
        } as any;
        // eslint-disable-next-line no-console
        console.info('Polyfilled crypto.randomUUID');
      }
    } catch {
      // ignore
    }
  } catch {
    // ignore errors in polyfill
  }
})();
