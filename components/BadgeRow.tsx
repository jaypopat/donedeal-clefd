import { useEffect, useId, useRef, useState } from 'react';
import { accessibleSummary, badgesFor, explain } from '../lib/display/explain';
import type { CardView } from '../lib/display/views';

const formatTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function BadgeRow({ view }: { view: CardView }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const id = useId();
  const explanation = explain(view, formatTime);

  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const toggled = (event: ToggleEvent) => {
      if (event.newState === 'closed') {
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
      }
    };
    element.addEventListener('toggle', toggled);
    return () => element.removeEventListener('toggle', toggled);
  }, []);

  useEffect(() => {
    const element = panel.current;
    const button = trigger.current;
    if (!element || !button) return;
    if (!open) { element.hidePopover(); return; }
    const place = () => {
      const rect = button.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 24);
      const height = Math.min(480, window.innerHeight - 24);
      element.style.width = `${width}px`;
      element.style.maxHeight = `${height}px`;
      element.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      const below = window.innerHeight - rect.bottom;
      element.style.top = `${below >= Math.min(height, 300) ? rect.bottom + 6 : Math.max(12, rect.top - Math.min(element.scrollHeight, height) - 6)}px`;
    };
    element.showPopover();
    place();
    close.current?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  return <div className="tyrekick">
    <button ref={trigger} className="badge-row" type="button" aria-label={accessibleSummary(view)}
      aria-expanded={open} aria-haspopup="dialog" aria-controls={id} onClick={() => setOpen(!open)}>
      <span className="brand">Tyrekick</span>
      {badgesFor(view).map((badge, index) => <span key={index} className={`badge ${badge.tone}`}>{badge.text}</span>)}
      <span aria-hidden="true" className="info">ⓘ</span>
    </button>
    <div ref={panel} id={id} className="explanation" popover="auto" role="dialog" aria-labelledby={`${id}-title`}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); } }}>
      <header><strong id={`${id}-title`}>Tyrekick · Listing signals</strong>
        <button ref={close} type="button" className="close" aria-label="Close explanation" onClick={() => setOpen(false)}>×</button>
      </header>
      <section aria-label="Price comparison">
        <h2>{explanation.price.heading}</h2>
        {explanation.price.scope && <p className="scope">{explanation.price.scope}</p>}
        <p>{explanation.price.summary}</p>
        {explanation.price.details.map((detail) => <p key={detail}>{detail}</p>)}
        {explanation.price.comparables.length > 0 && <><h3>Closest matches</h3><ul>
          {explanation.price.comparables.map((match) => <li key={match.url}><a href={match.url} target="_blank" rel="noopener noreferrer">{match.label}</a></li>)}
        </ul></>}
      </section>
      <section aria-label="Warning checks">
        <h2>{explanation.warnings.heading}</h2>
        {explanation.warnings.summary && <p>{explanation.warnings.summary}</p>}
        {explanation.warnings.findings.slice(0, 3).map((finding) => <article key={finding.title}>
          <h3>{finding.title}</h3>
          {finding.quotes.map((quote) => <blockquote key={quote}>{quote}</blockquote>)}
          {finding.fields.map((field) => <p key={field}>{field}</p>)}
          <p className="next-step">{finding.nextStep}</p>
        </article>)}
        {explanation.warnings.coverage && <p className="scope">{explanation.warnings.coverage}</p>}
      </section>
    </div>
  </div>;
}
