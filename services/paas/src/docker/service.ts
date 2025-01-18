import Docker from 'dockerode';
import { logger } from '../util/logger';

export class DockerService {
  private readonly docker: Docker;

  constructor(connectDocker: () => Docker) {
    this.docker = connectDocker();
  }

  public async findNetwork(args: {
    serviceId: string;
  }): Promise<string | undefined> {
    const networkInfos = await this.docker.listNetworks({
      filters: {
        label: ['managed-by=homelab-paas', `service-id=${args.serviceId}`],
      },
    });
    const network = networkInfos.at(0);
    if (!network) {
      return undefined;
    }
    return network.Id;
  }

  public async createNetwork(args: { serviceId: string }): Promise<string> {
    const network = await this.docker.createNetwork({
      Name: `homelab-paas-${args.serviceId}`,
      Labels: {
        'managed-by': 'homelab-paas',
        'service-id': args.serviceId,
      },
    });

    return network.id;
  }

  public async connectNetwork(args: {
    networkId: string;
    containerId: string;
  }): Promise<void> {
    const network = this.docker.getNetwork(args.networkId);
    await network.connect({
      Container: args.containerId,
    });
  }

  public async findAllContainers(): Promise<
    Array<{
      containerId: string;
      serviceId?: string;
      deploymentId?: string;
    }>
  > {
    const containerInfos = await this.docker.listContainers({
      filters: {
        label: ['managed-by=homelab-paas'],
      },
    });

    return containerInfos.map((containerInfo) => ({
      containerId: containerInfo.Id,
      serviceId: containerInfo.Labels['service-id'],
      deploymentId: containerInfo.Labels['deployment-id'],
    }));
  }

  public async terminateContainer(containerId: string): Promise<void> {
    const inactiveContainer = this.docker.getContainer(containerId);
    await inactiveContainer.stop();
    await inactiveContainer.remove();
  }

  public async runContainer(args: {
    image: string;
    serviceId: string;
    deploymentId: string;
    networkId: string;
  }): Promise<{ hostname: string }> {
    const hostname = `${args.serviceId}-${args.deploymentId}`;

    const container = await this.docker.createContainer({
      Image: args.image,
      name: hostname,
      Labels: {
        'managed-by': 'homelab-paas',
        'service-id': args.serviceId,
        'deployment-id': args.deploymentId,
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [args.networkId]: {
            NetworkID: args.networkId,
          },
        },
      },
    });
    await container.start();

    return { hostname };
  }

  public async isContainerRunning(args: {
    serviceId: string;
    deploymentId: string;
  }): Promise<boolean> {
    const containerInfos = await this.docker.listContainers({
      filters: {
        label: [
          'managed-by=homelab-paas',
          `service-id=${args.serviceId}`,
          `deployment-id=${args.deploymentId}`,
        ],
      },
    });

    return containerInfos.at(0)?.State === 'running';
  }

  public async pullImageIfNotPresent(image: string): Promise<void> {
    const existingImage = await this.docker.getImage(image).inspect();
    if (existingImage) {
      return;
    }

    await this.docker.pull(image);
  }
}
