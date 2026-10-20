import { Window } from 'happy-dom';

export function documentFrom(html: string, url: string): Document {
  const window = new Window({ url });
  window.document.body.innerHTML = html;
  // happy-dom implements lib.dom's Document under its own declarations.
  return window.document as unknown as Document;
}

export function nextDataScript(data: unknown): string {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
}
