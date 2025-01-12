import { TaskEnvelope } from './types'

export interface TaskQueue<TTask> {
  enqueue: (task: TTask) => Promise<void>
  dequeue: () => Promise<TaskEnvelope<TTask> | undefined>
}

export const createInMemoryTaskQueue = <TTask>(
  generateTaskId: () => string,
): TaskQueue<TTask> => {
  const queue: TaskEnvelope<TTask>[] = [];

  return {
    enqueue: async (task) => { queue.push({ taskId: generateTaskId(), task }) },
    dequeue: async () => queue.pop(),
  };
};
