export type Lifecycle = {
  registerShutdownHandler: (handler: ShutdownHandler) => void;
  shutdown: () => Promise<void>;
};

type ShutdownHandler = () => Promise<void> | void;

export const createLifecycle = (): Lifecycle => {
  const shutdownHandlers: ShutdownHandler[] = [];

  return {
    registerShutdownHandler: (handler: ShutdownHandler) => shutdownHandlers.push(handler),
    shutdown: async () => {
      await Promise.all(shutdownHandlers.map(handler => handler()));
    },
  };
};
