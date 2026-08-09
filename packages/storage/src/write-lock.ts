const queues = new Map<string, Promise<void>>();

export const serializeReplicaWrite = async <T>(
  keys: readonly string[],
  operation: () => Promise<T>,
): Promise<T> => {
  const uniqueKeys = [...new Set(keys)].sort();
  const predecessors = uniqueKeys.map((key) => queues.get(key) ?? Promise.resolve());
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = Promise.all(predecessors);
  const tail = ready.then(() => current);
  for (const key of uniqueKeys) {
    queues.set(key, tail);
  }
  await ready;
  try {
    return await operation();
  } finally {
    release();
    for (const key of uniqueKeys) {
      if (queues.get(key) === tail) {
        queues.delete(key);
      }
    }
  }
};
