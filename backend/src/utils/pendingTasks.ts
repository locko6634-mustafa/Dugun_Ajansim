const pendingBackgroundTasks = new Set<Promise<void>>();

export const trackPendingBackgroundTask = (task: Promise<unknown>): void => {
  let trackedTask: Promise<void>;
  trackedTask = task
    .then(
      () => undefined,
      () => undefined
    )
    .finally(() => {
      pendingBackgroundTasks.delete(trackedTask);
    });
  pendingBackgroundTasks.add(trackedTask);
};

export const drainPendingBackgroundTasks = async (): Promise<void> => {
  while (pendingBackgroundTasks.size > 0) {
    await Promise.all([...pendingBackgroundTasks]);
  }
};

export const getPendingBackgroundTaskCount = (): number => pendingBackgroundTasks.size;
