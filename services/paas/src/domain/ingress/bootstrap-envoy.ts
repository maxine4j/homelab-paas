import { readFile } from 'fs/promises';
import Docker, { Container } from 'dockerode';
import { createTar } from 'nanotar';
import { logger } from '../../util/logger';

const envoyImage = 'envoyproxy/envoy:v1.31-latest';

export interface BootstrapEnvoyService {
  (): Promise<void>
}

export const createBootstrapEnvoyService = (
  connectDocker: () => Docker,
): BootstrapEnvoyService => {
  const docker = connectDocker();

  const dockerLabels = {
    'managed-by': 'homelab-pass',
    'service-id': 'homelab-pass-envoy',
  };

  const isEnvoyRunning = async () => {
    const containers = await docker.listContainers({
      filters: {
        label: Object.entries(dockerLabels).map(([key, value]) => `${key}=${value}`),
      }
    });

    const envoyContainerInfo = containers.at(0);
    if (!envoyContainerInfo) {
      return false;
    }

    return true;
  }

  const createEnvoyConfigTarball = async () => {
    const envoyConfig = await readFile('/app/envoy.yaml', 'utf-8');
    return Buffer.from(createTar([
      { name: 'envoy.yaml', data: envoyConfig }
    ]));
  }

  return async () => {
    logger.info('Checking if envoy is running');

    if (await isEnvoyRunning()) {
      logger.info('Envoy already running');
      return;
    }
    logger.info('Envoy is missing, bootstrapping');

    await docker.pull(envoyImage);
    logger.info('Pulled envoy image');

    const container = await docker.createContainer({
      Image: envoyImage,
      name: 'homelab-pass-envoy',
      Labels: dockerLabels,
      ExposedPorts: {
        '8080/tcp': {}
      },
      HostConfig: {
        PortBindings: {
          '8080/tcp': [{
            HostPort: '8082'
          }]
        }
      }
    });
    logger.info('Created envoy container');

    const envoyConfigTarball = await createEnvoyConfigTarball();
    await container.putArchive(envoyConfigTarball, { path: '/etc/envoy/' });

    await container.start();
    logger.info('Started envoy container');
  };
};
