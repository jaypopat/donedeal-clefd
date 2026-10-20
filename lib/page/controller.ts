import { newDocumentNonce, parseListingHref, type ListingId } from '../contracts/ids';
import { classifyPage } from '../donedeal/page';
import { observeCards, readSearchData } from '../donedeal/search';
import { observeDetail } from '../donedeal/detail';
import type { CardView } from '../display/views';
import { BackgroundMessageSchema, type PageMessage } from '../messages';
import { acceptPrice, acceptWarning, newDetail, newSearch, openingFor, reconcileSearch, syncFor, viewOf, type PageModel } from './model';

export type MountedBadge = { update(view: CardView): void; remove(): void };
export type PageConnection = { postMessage(message: PageMessage): void; disconnect(): void };
export type ControllerDeps = {
  doc: Document;
  location(): URL;
  connect(receive: (message: unknown) => void, disconnected: () => void): PageConnection;
  mount(anchor: Element, view: CardView): Promise<MountedBadge>;
  now(): number;
};

type Mount = { anchor: Element; badge: MountedBadge | null };

export function createPageController(deps: ControllerDeps) {
  let stopped = false;
  let active = false;
  let generation: number | null = null;
  let connection: PageConnection | null = null;
  let connectionId = 0;
  let nonce = newDocumentNonce();
  let revision = 0;
  let pending = false;
  let model: PageModel | null = null;
  let pageKey = '';
  let visible = new Set<ListingId>();
  let reconnectDelay = 250;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const mounts = new Map<ListingId, Mount>();

  function removeBadges() {
    for (const mount of mounts.values()) mount.badge?.remove();
    mounts.clear();
  }

  function invalidate() {
    revision++;
    pending = false;
    model = null;
    visible.clear();
    clearTimeout(refreshTimer);
    removeBadges();
  }

  function disconnect() {
    connectionId++;
    const previous = connection;
    connection = null;
    previous?.disconnect();
  }

  function submit() {
    if (!active || pending || !model || !connection) return;
    const page = syncFor(model, visible);
    if (!page) return;
    try {
      connection.postMessage({ type: 'sync', documentNonce: nonce, page });
    } catch {
      lostConnection();
    }
  }

  function render() {
    if (!model || !active) return;
    const bindings = model.kind === 'detail' ? [model.binding] : [...model.bindings.values()];
    for (const binding of bindings) mounts.get(binding.facts.listingId)?.badge?.update(viewOf(binding));
  }

  async function mountBadges(anchors: ReadonlyMap<ListingId, Element>) {
    for (const [id, mount] of mounts) {
      if (anchors.get(id) !== mount.anchor || !mount.anchor.isConnected) {
        mount.badge?.remove();
        mounts.delete(id);
      }
    }
    if (!model) return;
    const bindings = model.kind === 'detail' ? [model.binding] : [...model.bindings.values()];
    await Promise.all(bindings.map(async (binding) => {
      const id = binding.facts.listingId;
      const anchor = anchors.get(id);
      if (!anchor || mounts.has(id)) return;
      const mount: Mount = { anchor, badge: null };
      mounts.set(id, mount);
      const badge = await deps.mount(anchor, viewOf(binding));
      if (stopped || !active || mounts.get(id) !== mount || !anchor.isConnected) {
        badge.remove();
        if (mounts.get(id) === mount) mounts.delete(id);
      } else mount.badge = badge;
    }));
    render();
  }

  async function reconcile(current: number) {
    if (!active || stopped) return;
    const location = deps.location();
    const route = classifyPage(location);
    const previous = model;
    const now = deps.now();
    let next: PageModel | null = null;
    const anchors = new Map<ListingId, Element>();
    if (route.kind === 'search') {
      const data = readSearchData({ doc: deps.doc, location, params: route.params, pathSegments: route.pathSegments });
      const cards = observeCards(deps.doc, data).slice(0, 300);
      for (const card of cards) anchors.set(card.facts.listingId, card.anchor);
      const search = previous?.kind === 'search' && previous.searchKey === route.searchKey ? previous : newSearch(route.searchKey, now);
      next = (await reconcileSearch(search, cards, now)).model;
    } else if (route.kind === 'detail') {
      const detail = observeDetail(deps.doc, route.listing);
      if (detail) {
        anchors.set(detail.facts.listingId, detail.anchor);
        const fresh = await newDetail(detail, now);
        next = previous?.kind === 'detail' && previous.binding.contentFp === fresh.binding.contentFp ? previous : fresh;
      }
    }
    if (stopped || !active || current !== revision) return;
    model = next;
    pending = false;
    if (!next) removeBadges();
    else {
      const cards = observeCards(deps.doc, null);
      visible = new Set(cards.filter(({ element }) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < (deps.doc.defaultView?.innerHeight ?? 0);
      }).map(({ facts }) => facts.listingId));
      render();
      submit();
      await mountBadges(anchors);
    }
  }

  function refresh() {
    if (!active || stopped) return;
    pending = true;
    const current = ++revision;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void reconcile(current).catch(() => {
        if (revision !== current || stopped) return;
        pending = false;
        removeBadges();
      });
    }, 80);
  }

  function lostConnection() {
    if (stopped) return;
    disconnect();
    active = false;
    invalidate();
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000);
  }

  function connect() {
    if (stopped) return;
    disconnect();
    nonce = newDocumentNonce();
    const id = connectionId;
    try {
      connection = deps.connect((raw) => {
        if (id !== connectionId || stopped) return;
        const parsed = BackgroundMessageSchema.safeParse(raw);
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === 'status') {
          reconnectDelay = 250;
          const changed = generation !== null && (generation !== message.generation || active !== message.active);
          generation = message.generation;
          active = message.active;
          if (changed) {
            invalidate();
            connect();
          } else if (active) refresh();
          else invalidate();
          return;
        }
        if (!active || pending || !model || message.documentNonce !== nonce) return;
        if (message.type === 'price') for (const delivery of message.deliveries) model = acceptPrice(model, delivery) ?? model;
        else for (const delivery of message.deliveries) model = acceptWarning(model, delivery) ?? model;
        render();
      }, () => { if (id === connectionId) lostConnection(); });
    } catch {
      lostConnection();
    }
  }

  function locationChanged() {
    const route = classifyPage(deps.location());
    const key = route.kind === 'search' ? route.searchKey : route.kind === 'detail' ? route.listing.url : 'unsupported';
    if (key === pageKey) return;
    pageKey = key;
    invalidate();
    if (connection) connect();
  }

  function opened(href: string) {
    if (!active || pending || !model || !connection) return;
    const listing = parseListingHref(href);
    const opening = listing ? openingFor(model, listing.id) : null;
    if (opening) {
      try { connection.postMessage({ type: 'opened', documentNonce: nonce, opening }); }
      catch { lostConnection(); }
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    active = false;
    clearTimeout(reconnectTimer);
    invalidate();
    disconnect();
  }

  locationChanged();
  connect();
  function prioritise() {
    const next = new Set([...mounts].filter(([, { anchor }]) => {
      const rect = anchor.getBoundingClientRect();
      return rect.bottom > -200 && rect.top < (deps.doc.defaultView?.innerHeight ?? 0) + 200;
    }).map(([id]) => id));
    if (next.size === visible.size && [...next].every((id) => visible.has(id))) return;
    visible = next;
    submit();
  }
  function suspend() {
    active = false;
    clearTimeout(reconnectTimer);
    invalidate();
    disconnect();
  }
  return { refresh, locationChanged, opened, stop, prioritise, suspend, resume: connect };
}
