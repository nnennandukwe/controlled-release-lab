import { setTimeout as delay } from 'node:timers/promises';

/** Deliberately seeded Build 4 fixture, not a naturally occurring agent defect.
 * The subsequent repair removes this source-level delay; there is no runtime switch.
 */
export async function applySearchTeachingFixture(query: string, ranked: boolean): Promise<void> {
  if (ranked && query.trim().toLowerCase() === 'workspace') await delay(1000);
}
