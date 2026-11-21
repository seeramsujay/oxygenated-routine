/**
 * @fileoverview User profile schema, sanitization, and validation.
 *
 * All inputs originating from the client browser are treated as completely untrusted.
 * Strips ASCII control characters to prevent prompt injection or terminal escape exploits,
 * imposes strict length boundaries, validates geographic coordinates within legitimate
 * physical bounds (-90 to +90 lat, -180 to +180 lon), and populates sensible regional defaults.
 */
import { z } from 'zod';
import { badRequest } from './errors.js';

// Strip ASCII control characters (preserving legitimate whitespace \t \n) to eliminate prompt injection vectors.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Zod string transformer that strips control characters, enforces maximum length, and trims whitespace. */
const cleanText = (max) =>
  z
    .string()
    .max(max)
    .transform((s) => s.replace(CONTROL_CHARS, '').trim());

/** Household member count bounded between 0 and 12. */
const count = z.number().int().min(0).max(12);

/** Supported commute transit modes. */
export const COMMUTE_MODES = ['car', 'motorbike', 'bus', 'metro', 'bike', 'walk', 'wfh'];

/** Supported domestic space-heating sources. */
export const HEATING = ['wood', 'coal', 'gas', 'electric', 'heat_pump', 'district', 'none'];

/** Supported domestic cooking fuel types. */
export const COOKING = ['gas', 'electric', 'induction', 'biomass'];

/** Pre-existing medical conditions and health vulnerabilities sensitive to airborne particulate matter. */
export const CONDITIONS = ['asthma', 'copd', 'heart_disease', 'pregnancy', 'allergies'];

/**
 * Standard baseline assumptions for a default single-step request.
 * Only `location` is required from the user; all other dimensions use these typical values
 * until the user customizes their answers in the "Personalise" section.
 */
export const DEFAULTS = Object.freeze({
  household: { adults: 2, children: 0, seniors: 0, conditions: [] },
  commute: { mode: 'car', oneWayKm: 8, daysPerWeek: 5 },
  home: { heating: 'electric', cooking: 'gas', hasPurifier: false },
  budget: 'medium',
  outdoorHours: 2,
});

/** Strong Zod validation schema for user profiles. */
export const ProfileSchema = z.object({
  location: cleanText(100).pipe(z.string().min(2, 'Enter a city or town')),
  /** Browser GPS coordinates (rounded by the client for location privacy); bypasses geocoding. */
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
  /** Optional manual AQI reading from a personal monitor; overrides live network data for offline usage. */
  manualAqi: z.number().int().min(0).max(500).optional(),
});

/**
 * Validates untrusted request input against ProfileSchema.
 *
 * @param {unknown} input - Raw request payload.
 * @returns {import('zod').infer<typeof ProfileSchema>} Sanitized profile.
 * @throws {AppError} 400 Bad Request if validation fails.
 */
export function parseProfile(input) {
  const result = ProfileSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw badRequest('Some answers need attention.', issues);
  }
  return result.data;
}

/**
 * Assesses whether any household member belongs to an epidemiologically vulnerable group
 * (children whose lungs are developing, seniors, individuals with respiratory/cardiac disease, or pregnancy).
 *
 * @param {object} profile - Validated profile.
 * @returns {boolean} True if stricter outdoor exposure guidelines apply.
 */
export const isSensitive = (profile) =>
  profile.household.children > 0 || profile.household.seniors > 0 || profile.household.conditions.length > 0;
