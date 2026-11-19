/** Shape of the plan returned to the browser — produced by Claude or by the rule engine. */
import { z } from 'zod';

const cost = z.enum(['free', 'low', 'medium', 'high']);

export const PlanSchema = z.object({
  headline: z.string(),
  risk_summary: z.string(),
  /** The three things to do first, in plain words. */
  top_actions: z.array(z.string()),
  daily_routine: z.array(
    z.object({
      when: z.enum(['morning', 'midday', 'afternoon', 'evening', 'night']),
      action: z.string(),
      why: z.string(),
      impact: z.string(),
    }),
  ),
  indoor_air_hacks: z.array(z.object({ title: z.string(), steps: z.array(z.string()), cost, why: z.string() })),
  sustainable_alternatives: z.array(
    z.object({ swap: z.string(), benefit: z.string(), effort: z.enum(['easy', 'moderate', 'hard']) }),
  ),
  community_actions: z.array(z.string()),
  protect_vulnerable_members: z.array(z.string()),
  seek_medical_help_if: z.array(z.string()),
});
