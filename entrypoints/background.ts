import { browser, type Browser } from 'wxt/browser';
import { createBackground, startCacheCleanup } from '../lib/extension/background';
import { createAssessClient } from '../lib/extension/client';
import { API_BASE } from '../lib/extension/config';
import type { StorageArea } from '../lib/extension/store';
import { createStore } from '../lib/extension/store';
import type { BackgroundMessage } from '../lib/messages';
import { PAGE_PORT } from '../lib/messages';

function area(storage: Browser.storage.StorageArea): StorageArea {
  return {
    get: async (key) => (await storage.get(key))[key],
    set: (key, value) => storage.set({ [key]: value }),
    remove: (key) => storage.remove(key),
  };
}

export default defineBackground(() => {
  const ports = new Map<string, Browser.runtime.Port>();
  const store = createStore({ local: area(browser.storage.local), session: area(browser.storage.session), now: Date.now });
  void startCacheCleanup(store, browser.alarms);
  browser.runtime.onStartup.addListener(() => void store.snapshot());
  const background = createBackground({
    store,
    send: createAssessClient({ baseUrl: API_BASE }),
    post(docId, message: BackgroundMessage) {
      try {
        ports.get(docId)?.postMessage(message);
      } catch {
        ports.delete(docId);
      }
    },
    now: Date.now,
  });

  browser.runtime.onConnect.addListener((port) => {
    const tabId = port.sender?.tab?.id;
    if (port.name !== PAGE_PORT || tabId === undefined || port.sender?.frameId !== 0) {
      port.disconnect();
      return;
    }
    const docId = crypto.randomUUID();
    ports.set(docId, port);
    port.onMessage.addListener((message) => void background.onPageMessage(docId, message));
    port.onDisconnect.addListener(() => {
      ports.delete(docId);
      background.disconnect(docId);
    });
    void background.connect({ id: docId, tabId, openerTabId: port.sender?.tab?.openerTabId ?? null, documentNonce: null });
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL('/popup.html')) return;
    void background.onPopupMessage(message).then(sendResponse);
    return true;
  });
});
