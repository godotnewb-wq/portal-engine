/** One LLM call's prompt: the stable system part first, so providers can cache it, and the per-turn part last. */
export interface Prompt {
  system: string
  /** Per-turn material, last, so the stable prefix caches. */
  user: string
}
