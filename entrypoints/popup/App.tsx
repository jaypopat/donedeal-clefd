import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { PopupStateSchema, type PopupState } from '../../lib/extension/settings';
import type { PopupRequest } from '../../lib/messages';

export default function App() {
  const [state, setState] = useState<PopupState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  async function request(message: PopupRequest) {
    setBusy(true);
    setError(null);
    try {
      const next = PopupStateSchema.parse(await browser.runtime.sendMessage(message));
      setState(next);
      setNotice(message.type === 'clear-data' ? 'Local assessments and saved search context cleared.' : '');
    } catch {
      setError('Tyrekick could not connect. Reload the extension and try again.');
    } finally { setBusy(false); }
  }

  useEffect(() => { void request({ type: 'get-state' }); }, []);

  return <main>
    <header><span className="mark" aria-hidden="true">t</span><div><h1>Tyrekick</h1><p>Spot promising cars and warning signs.</p></div></header>
    <p>Price signals compare similar cars loaded in your current DoneDeal search. They are asking-price observations, not a vehicle valuation.</p>
    <section aria-labelledby="processing-title">
      <h2 id="processing-title">Before you enable</h2>
      <p>Tyrekick sends vehicle facts and redacted listing titles and descriptions to its Worker and Cloudflare Workers AI for processing.</p>
      <p>It reads car results and ads you open. It does not fetch other ads automatically. Contact details, cookies, and seller profiles are not collected.</p>
      <p>Assessments expire after 30 minutes. Expired data is removed when Chrome next runs cleanup. No listing database is kept by the Worker.</p>
    </section>
    {state && <>
      <p className="status"><span className={`dot ${state.access}`} />{state.access === 'enabled' ? 'Enabled on DoneDeal Cars' : state.access === 'paused' ? 'Analysis paused' : 'Not enabled'}</p>
      <button className="primary" disabled={busy} onClick={() => void request({ type: state.access === 'enabled' ? 'pause' : 'enable' })}>
        {state.access === 'enabled' ? 'Pause analysis' : state.access === 'paused' ? 'Resume analysis' : 'Agree and enable'}
      </button>
      <button className="secondary" disabled={busy} onClick={() => void request({ type: 'clear-data' })}>Clear local data</button>
      <p className="small">{state.cachedAssessments} cached assessments. Clearing removes assessments and search context. Enabled pages can then analyse again. Pause first to keep the cache empty.</p>
    </>}
    {!state && !error && <p role="status">Connecting…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <><p role="alert">{error}</p><button onClick={() => void request({ type: 'get-state' })}>Try again</button></>}
    <footer>Prototype v0.2 · Local development Worker required.<br />A price signal does not verify a car or seller.</footer>
  </main>;
}
