export const findBoundedIntervalConflicts = <T>(
  values: readonly T[],
  options: {
    groupKey: (value: T) => string;
    startsAt: (value: T) => Date;
    endsAt: (value: T) => Date;
    maxConflicts?: number;
  },
): { pairs: Array<readonly [T, T]>; truncated: boolean } => {
  const maxConflicts = options.maxConflicts ?? 250;
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = options.groupKey(value);
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }

  const pairs: Array<readonly [T, T]> = [];
  for (const group of groups.values()) {
    group.sort((left, right) => options.startsAt(left).valueOf() - options.startsAt(right).valueOf());
    let active: T[] = [];
    for (const current of group) {
      const currentStart = options.startsAt(current);
      active = active.filter((candidate) => options.endsAt(candidate) > currentStart);
      for (const candidate of active) {
        if (pairs.length >= maxConflicts) return { pairs, truncated: true };
        pairs.push([candidate, current]);
      }
      active.push(current);
    }
  }
  return { pairs, truncated: false };
};
