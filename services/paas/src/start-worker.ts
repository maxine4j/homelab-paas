import Docker from 'dockerode';
import { createBootstrapEnvoyService } from './domain/ingress/bootstrap-envoy';

export const startWorker = async () => {
  const docker = new Docker();

  const bootstrapEnvoy = createBootstrapEnvoyService(() => docker);

  await bootstrapEnvoy();
};
