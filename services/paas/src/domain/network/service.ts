import { DockerService } from '../../docker/service';
import { ConfigService } from '../../util/config';
import { logger } from '../../util/logger';
import { DeploymentRepository } from '../service/deployment/repository';
import { ServiceRepository } from '../service/repository';

export class NetworkService {
  constructor(
    private readonly dockerService: DockerService,
    private readonly configService: ConfigService,
    private readonly serviceRepository: ServiceRepository,
    private readonly deploymentRepository: DeploymentRepository,
  ) {}

  private async getServiceProxyEgressAliases(serviceId: string) {
    const service = await this.serviceRepository.queryService(serviceId);
    if (!service?.activeDeploymentId) {
      return [];
    }

    const deployment = await this.deploymentRepository.query(
      service.activeDeploymentId,
    );
    if (!deployment?.serviceDescriptor.networking.serviceProxy?.egress) {
      return [];
    }

    return deployment.serviceDescriptor.networking.serviceProxy?.egress?.map(
      (targetServiceId) => `${targetServiceId}.mesh`,
    );
  }

  public async findServiceNetworkId(serviceId: string): Promise<string> {
    const existingNetorkId = await this.dockerService.findNetwork({
      serviceId,
    });
    if (existingNetorkId) {
      return existingNetorkId;
    }

    return await this.dockerService.createNetwork({ serviceId });
  }

  public async configureServiceNetwork(serviceId: string): Promise<void> {
    const networkId = await this.findServiceNetworkId(serviceId);

    const dnsAliases = await this.getServiceProxyEgressAliases(serviceId);

    await this.dockerService.disconnectNetwork({
      containerId: this.configService.getPaasContainerHostname(),
      networkId,
    });

    await this.dockerService.connectNetwork({
      containerId: this.configService.getPaasContainerHostname(),
      networkId,
      dnsAliases,
    });
    logger.info({ serviceId, dnsAliases }, 'Reconfigured service network');
  }
}
