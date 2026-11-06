import { z } from 'zod'

/** Every content id: lower-case words joined by hyphens, so ids read the same in files, saves and prompts. */
export const IdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'ids are lower-case words joined by hyphens')
