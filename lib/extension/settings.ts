import { z } from 'zod';
import { EpochMsSchema } from '../contracts/ids';
import { CONSENT_VERSION } from '../contracts/versions';

const ConsentSchema = z.strictObject({ version: z.literal(CONSENT_VERSION), grantedAt: EpochMsSchema });
type Consent = z.infer<typeof ConsentSchema>;

export const AccessSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('not_consented') }),
  z.strictObject({ kind: z.literal('enabled'), consent: ConsentSchema }),
  z.strictObject({ kind: z.literal('paused'), consent: ConsentSchema }),
]);
export type Access = z.infer<typeof AccessSchema>;

/** `generation` increases on every clear so late results from before it are rejected. */
export const SettingsSchema = z.strictObject({
  version: z.literal(1),
  generation: z.int().min(0),
  access: AccessSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = { version: 1, generation: 0, access: { kind: 'not_consented' } };

export const PopupStateSchema = z.strictObject({
  access: z.enum(['not_consented', 'enabled', 'paused']),
  cachedAssessments: z.int().min(0),
});
export type PopupState = z.infer<typeof PopupStateSchema>;

export function isActive(settings: Settings): boolean {
  return settings.access.kind === 'enabled';
}

export function enable(settings: Settings, now: number): Settings {
  const consent: Consent = settings.access.kind === 'not_consented' ? { version: CONSENT_VERSION, grantedAt: now } : settings.access.consent;
  return { ...settings, access: { kind: 'enabled', consent } };
}

export function pause(settings: Settings): Settings {
  return settings.access.kind === 'enabled' ? { ...settings, access: { kind: 'paused', consent: settings.access.consent } } : settings;
}
