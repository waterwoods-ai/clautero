/**
 * ModelSelection — per-session model choice with a persistent seed.
 *
 * Ported from Claudian's model persistence redesign (#1058), reduced to
 * Clautero's needs: each session owns its model; the last explicit pick
 * seeds new sessions only (existing sessions never follow the seed); and
 * commits are ordered by picker intent so a stale async commit can never
 * overwrite a newer choice.
 */

/** Claude's cycle list; other providers supply their own (often empty). */
export const CLAUDE_MODELS: readonly string[] = Object.freeze(["sonnet", "opus", "haiku", "fable"]);

/**
 * Next model in a provider's cycle. An empty list means the provider
 * manages its own default — there is nothing to cycle ("" = auto).
 */
export function nextModel(current: string, models: readonly string[] = CLAUDE_MODELS): string {
  if (models.length === 0) return "";
  const idx = models.indexOf(current);
  return models[(idx + 1) % models.length];
}

/** Model for a brand-new session: seed → provider default → auto. */
export function resolveNewSessionModel(
  seed: string | null | undefined,
  models: readonly string[] = CLAUDE_MODELS
): string {
  if (models.length === 0) return "";
  if (seed && models.includes(seed)) return seed;
  return models[0];
}

/** Model for an existing session: its own binding → seed → default. */
export function resolveSessionModel(
  bound: string | null | undefined,
  seed: string | null | undefined,
  models: readonly string[] = CLAUDE_MODELS
): string {
  if (bound && models.includes(bound)) return bound;
  return resolveNewSessionModel(seed, models);
}

/**
 * Orders async model-commit work by picker intent: a commit is applied only
 * if no newer intent has committed and its validity predicate still holds.
 */
export function createModelSelectionCoordinator() {
  let nextIntent = 0;
  let committedIntent = 0;
  let commitTail: Promise<unknown> = Promise.resolve();

  function beginIntent(): number {
    return ++nextIntent;
  }

  function commitIntent(
    intent: number,
    apply: () => Promise<void> | void,
    isStillValid: () => boolean = () => true
  ): Promise<boolean> {
    const commit = commitTail.then(async () => {
      if (intent <= committedIntent || !isStillValid()) return false;
      await apply();
      committedIntent = intent;
      return true;
    });
    commitTail = commit.then(() => undefined, () => undefined);
    return commit;
  }

  return { beginIntent, commitIntent };
}
