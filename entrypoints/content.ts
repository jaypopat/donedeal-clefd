import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { BadgeRow } from '../components/BadgeRow';
import badgeCss from '../components/badges.css?inline';
import { CARD_SELECTOR } from '../lib/donedeal/search';
import { PAGE_PORT } from '../lib/messages';
import { createPageController } from '../lib/page/controller';

export default defineContentScript({
  matches: ['https://www.donedeal.ie/*'],
  main(ctx) {
    const controller = createPageController({
      doc: document,
      location: () => new URL(location.href),
      now: Date.now,
      connect(receive, disconnected) {
        const port = browser.runtime.connect({ name: PAGE_PORT });
        port.onMessage.addListener(receive);
        port.onDisconnect.addListener(disconnected);
        return {
          postMessage: (message) => port.postMessage(message),
          disconnect() {
            port.onMessage.removeListener(receive);
            port.onDisconnect.removeListener(disconnected);
            port.disconnect();
          },
        };
      },
      async mount(anchor, view) {
        const ui = await createShadowRootUi(ctx, {
          name: 'tyrekick-badges', position: 'inline', anchor, append: 'last', css: badgeCss,
          isolateEvents: ['click', 'auxclick', 'pointerdown', 'keydown', 'keyup'],
          onMount(container) {
            const root = createRoot(container);
            root.render(createElement(BadgeRow, { view }));
            return root;
          },
          onRemove(root) { root?.unmount(); },
        });
        if (ctx.isInvalid) return { update() {}, remove() {} };
        ui.mount();
        return { update: (next) => ui.mounted?.render(createElement(BadgeRow, { view: next })), remove: ui.remove };
      },
    });

    const intersections = new IntersectionObserver(() => controller.prioritise(), { rootMargin: '200px' });
    const observeCards = () => {
      intersections.disconnect();
      document.querySelectorAll(CARD_SELECTOR).forEach((card) => intersections.observe(card));
    };
    const belongsToTyrekick = (node: Node) => node.nodeType === Node.ELEMENT_NODE && node instanceof Element && node.matches('tyrekick-badges');
    const mutations = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(belongsToTyrekick)) return false;
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target?.closest('tyrekick-badges')) return false;
        return target?.closest(`${CARD_SELECTOR}, #__NEXT_DATA__, [class*="AdTitleBox-styled__"], [data-testid="ad-description-panel"]`) ||
          [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element && (node.matches(CARD_SELECTOR) || node.querySelector(`${CARD_SELECTOR}, #__NEXT_DATA__`)));
      });
      if (relevant) { controller.locationChanged(); controller.refresh(); observeCards(); }
    });
    mutations.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href', 'class'] });
    observeCards();
    const trackOpening = (event: MouseEvent) => {
      if (event.button > 1 || event.composedPath().some((node) => node instanceof Element && node.matches('tyrekick-badges'))) return;
      const link = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
      if (link instanceof HTMLAnchorElement) controller.opened(link.href);
    };
    ctx.addEventListener(document, 'click', trackOpening, { capture: true });
    ctx.addEventListener(document, 'auxclick', trackOpening, { capture: true });
    ctx.addEventListener(document, 'pointerdown', trackOpening, { capture: true });
    ctx.addEventListener(window, 'wxt:locationchange', () => { controller.locationChanged(); controller.refresh(); observeCards(); });
    ctx.addEventListener(window, 'pageshow', (event) => { if (event.persisted) controller.resume(); controller.refresh(); observeCards(); });
    ctx.addEventListener(window, 'pagehide', () => controller.suspend());
    ctx.addEventListener(window, 'focus', () => controller.refresh());
    ctx.setInterval(() => controller.refresh(), 60_000);
    ctx.onInvalidated(() => { mutations.disconnect(); intersections.disconnect(); controller.stop(); });
  },
});
