/** Request validation. Everything from the browser is untrusted. */
import { z } from 'zod';
import { badRequest } from './errors.js';

// Strip control characters (keeps \t \n) so they can't smuggle odd content into prompts.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const cleanText = (max) =>
  z
    .string()
    .max(max)
    .transform((s) => s.replace(CONTROL_CHARS, '').trim());
const count = z.number().int().min(0).max(12);

export const COMMUTE_MODES = ['car', 'motorbike', 'bus', 'metro', 'bike', 'walk', 'wfh'];
export const HEATING = ['wood', 'coal', 'gas', 'electric', 'heat_pump', 'district', 'none'];
export const COOKING = ['gas', 'electric', 'induction', 'biomass'];
export const CONDITIONS = ['asthma', 'copd', 'heart_disease', 'pregnancy', 'allergies'];

/**
 * Only `location` is required. Everything else falls back to a typical household so a first answer
 * takes a single step; the response says when defaults were assumed.
 */
export const DEFAULTS = Object.freeze({
  household: { adults: 2, children: 0, seniors: 0, conditions: [] },
  commute: { mode: 'car', oneWayKm: 8, daysPerWeek: 5 },
  home: { heating: 'electric', cooking: 'gas', hasPurifier: false },
  budget: 'medium',
  outdoorHours: 2,
});

export const ProfileSchema = z.object({
  location: cleanText(100).pipe(z.string().min(2, 'Enter a city or town')),
  /** Browser location (rounded by the client); skips the place-name lookup. */
  coordinates: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).optional(),
  household: z
    .object({
      adults: count,
      children: count,
      seniors: count,
      conditions: z.array(z.enum(CONDITIONS)).max(CONDITIONS.length),
    })
    .default(DEFAULTS.household),
  commute: z
    .object({
      mode: z.enum(COMMUTE_MODES),
      oneWayKm: z.number().min(0).max(200),
      daysPerWeek: z.number().int().min(0).max(7),
    })
    .default(DEFAULTS.commute),
  home: z
    .object({
      heating: z.enum(HEATING),
      cooking: z.enum(COOKING),
      hasPurifier: z.boolean(),
    })
    .default(DEFAULTS.home),
  budget: z.enum(['low', 'medium', 'high']).default(DEFAULTS.budget),
  outdoorHours: z.number().min(0).max(12).default(DEFAULTS.outdoorHours),
  notes: cleanText(300).default(''),
  /** Optional AQI from a local monitor; overrides live data and works fully offline. */
  manualAqi: z.number().int().min(0).max(500).optional(),
});

/** @returns the validated, normalised profile; throws an AppError(400) otherwise */
export function parseProfile(input) {
  const result = ProfileSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw badRequest('Some answers need attention.', issues);
  }
  return result.data;
}

/** True if anyone in the household is in a group the guidance treats more cautiously. */
export const isSensitive = (profile) =>
  profile.household.children > 0 || profile.household.seniors > 0 || profile.household.conditions.length > 0;
