import Docker from 'dockerode';

export interface DockerService {
  findNetwork: (args: {
    serviceId: string
  }) => Promise<string | undefined>

  createNetwork: (args: {
    serviceId: string
  }) => Promise<string>

  connectNetwork: (args: {
    networkId: string
    containerName: string
  }) => Promise<void>

  findAllContainers: () => Promise<Array<{
    containerId: string
    serviceId?: string
    deploymentId?: string
  }>>

  terminateContainer: (containerId: string) => Promise<void>

  runContainer: (args: {
    image: string,
    serviceId: string,
    deploymentId: string,
    networkId: string,
  }) => Promise<{ hostname: string }>

  pullImageIfNotPresent: (image: string) => Promise<void>

  isContainerRunning: (args: {
    serviceId: string,
    deploymentId: string,
  }) => Promise<boolean>,
}

export const createDockerService = (
  connectDocker: () => Docker,
): DockerService => {

  const docker = connectDocker();

  return {
    findNetwork: async ({ serviceId }) => {
      const networkInfos = await docker.listNetworks({
        filters: {
          label: [
            'managed-by=homelab-paas',
            `service-id=${serviceId}`,
          ]
        }
      });
      const network = networkInfos.at(0);
      if (!network) { 
        return undefined;
      }
      return network.Id;
    },

    createNetwork: async ({ serviceId }) => {
      const network = await docker.createNetwork({
        Name: `homelab-paas-${serviceId}`,
        Labels: {
          'managed-by': 'homelab-paas',
          'service-id': serviceId,
        }
      });

      return network.id;
    },

    connectNetwork: async ({ containerName, networkId }) => {
      const network = docker.getNetwork(networkId);
      await network.connect({
        Container: containerName,
      });
    },

    findAllContainers: async () => {
      const containerInfos = await docker.listContainers({
        filters: {
          label: [
            'managed-by=homelab-paas',
          ]
        }
      });

      return containerInfos.map(containerInfo => ({
        containerId: containerInfo.Id,
        serviceId: containerInfo.Labels['service-id'],
        deploymentId: containerInfo.Labels['deployment-id'],
      }));
    },

    terminateContainer: async (containerId) => {
      const inactiveContainer = docker.getContainer(containerId);
      await inactiveContainer.stop();
      await inactiveContainer.remove();
    },

    runContainer: async ({
      image,
      serviceId,
      deploymentId,
      networkId,
    }) => {

      const hostname = `${serviceId}-${deploymentId}`;

      const container = await docker.createContainer({
        Image: image,
        name: hostname,
        Labels: {
          'managed-by': 'homelab-paas',
          'service-id': serviceId,
          'deployment-id': deploymentId,
        },
        NetworkingConfig: {
          EndpointsConfig: {
            [networkId]: {
              NetworkID: networkId,
            },
          },
        }
      });
      await container.start();

      return { hostname };
    },

    isContainerRunning: async ({ serviceId, deploymentId }) => {
      const containerInfos = await docker.listContainers({
        filters: {
          label: [
            'managed-by=homelab-paas',
            `service-id=${serviceId}`,
            `deployment-id=${deploymentId}`,
          ],
        }
      });
      
      return containerInfos.at(0)?.State === 'running';
    },

    pullImageIfNotPresent: async (image: string) => {
      const existingImage = await docker.getImage(image).inspect();
      if (existingImage) {
        return;
      }
    
      await docker.pull(image);
    }
  }
};
