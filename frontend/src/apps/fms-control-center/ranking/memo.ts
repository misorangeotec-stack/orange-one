/**
 * Build a derived structure once per loaded dataset.
 *
 * The open half of the ranking asks every module about every person — about seventy
 * calls per module per run — and the edge function has roughly two seconds of CPU
 * in all. An index that only depends on the dataset must not be rebuilt seventy
 * times. Keyed weakly on the dataset object, so nothing outlives the run.
 */
export function perDataset<D extends object, R>(build: (data: D) => R): (data: D) => R {
  const cache = new WeakMap<D, R>();
  return (data) => {
    let hit = cache.get(data);
    if (hit === undefined) {
      hit = build(data);
      cache.set(data, hit);
    }
    return hit;
  };
}
