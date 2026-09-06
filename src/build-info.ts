import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const buildInfoSchema = z.object({
  sourceSha: z.string().regex(/^(local|[a-f0-9]{40})$/),
  buildRunId: z.string().min(1).max(200),
  catalogVersion: z.literal('1'),
}).strict();
export type BuildInfo = z.infer<typeof buildInfoSchema>;

export async function loadBuildInfo(): Promise<BuildInfo> {
  try {
    return buildInfoSchema.parse(JSON.parse(await readFile(new URL('../build-info.json', import.meta.url), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !import.meta.url.includes('/dist/')) {
      return { sourceSha: 'local', buildRunId: 'local', catalogVersion: '1' };
    }
    throw new Error('Build metadata is missing or invalid. Run npm run build.', { cause: error });
  }
}
