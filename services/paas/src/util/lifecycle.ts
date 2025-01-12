export type Lifecycle = {
  registerShutdownHandler: (handler: ShutdownHandler) => void;
  shutdown: () => Promise<void>;
  isOpen: () => boolean;
};

type ShutdownHandler = () => Promise<void> | void;

export const createLifecycle = (): Lifecycle => {
  let isOpen = true;
  const shutdownHandlers: ShutdownHandler[] = [];

  return {
    registerShutdownHandler: (handler: ShutdownHandler) => shutdownHandlers.push(handler),
    shutdown: async () => {
      isOpen = false;
      await Promise.all(shutdownHandlers.map(handler => handler()));
    },
    isOpen: () => isOpen,
  };
};
