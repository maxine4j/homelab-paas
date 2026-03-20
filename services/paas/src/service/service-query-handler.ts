import { RouterContext } from '@koa/router';
import { DeploymentRepository, DeploymentRecord } from './deployment/repository';
import { ServiceRepository } from './repository';
import { ServiceSummary } from '@homelab-paas/shared-contracts';

export class ServiceQueryHandler {
  constructor(
    private readonly serviceRepository: ServiceRepository,
    private readonly deploymentRepository: DeploymentRepository,
  ) {}

  getAllServices = async (ctx: RouterContext) => {
    const services = await this.serviceRepository.queryAllServices();
    
    const deploymentsMap = new Map<string, DeploymentRecord[]>();
    const deploymentPromises = services.map(async (service) => {
      const deployments = await this.deploymentRepository.queryByService(service.serviceId);
      deploymentsMap.set(service.serviceId, deployments);
    });
    
    await Promise.all(deploymentPromises);

    const enriched = services.map((service) => {
      const deployments = deploymentsMap.get(service.serviceId) || [];
      const activeDeployment = deployments.find(d => d.status === 'running') || deployments[0];
      
      // Extract fields from service descriptor with defaults
      const serviceDescriptor = activeDeployment?.serviceDescriptor;
      const ingress = serviceDescriptor?.networking?.ingress;
      const serviceProxy = serviceDescriptor?.networking?.serviceProxy;
      const hostPorts = serviceDescriptor?.networking?.hostPorts;
      const environment = serviceDescriptor?.environment;
      const volumes = serviceDescriptor?.volumes;

      return {
        id: service.serviceId,
        // TODO: Pull real status from deployment health checks
        status: activeDeployment?.status === 'running' ? 'healthy' : 'unhealthy',
        // TODO: Pull real replica count from deployment spec
        replicas: activeDeployment?.container ? 1 : 0,
        // TODO: Pull real ownerId from deployment metadata
        ownerId: 'unknown',
        image: serviceDescriptor?.image || 'unknown',
        port: ingress?.containerPort || 0,
        serviceProxy: serviceProxy?.ingress || serviceProxy?.egress || [],
        hostPorts: hostPorts?.reduce((acc, hp) => {
          acc[hp.containerPort.toString()] = hp.hostPort;
          return acc;
        }, {} as Record<string, number>) || {},
        environment: environment || {},
        volumes: volumes || [],
      };
    });

    ctx.body = enriched;
  };

  getService = async (ctx: RouterContext) => {
    const serviceId = ctx.params['serviceId'];
    const serviceRecord = await this.serviceRepository.queryService(serviceId ?? '');
    if (!serviceId || !serviceRecord) {
      ctx.status = 404;
      return;
    }

    const deployments = await this.deploymentRepository.queryByService(serviceId);
    const activeDeployment = deployments.find(d => d.status === 'running') || deployments[0];
    
    // Extract fields from service descriptor with defaults
    const serviceDescriptor = activeDeployment?.serviceDescriptor;
    const ingress = serviceDescriptor?.networking?.ingress;
    const serviceProxy = serviceDescriptor?.networking?.serviceProxy;
    const hostPorts = serviceDescriptor?.networking?.hostPorts;
    const environment = serviceDescriptor?.environment;
    const volumes = serviceDescriptor?.volumes;

    const enriched: ServiceSummary = {
      id: serviceRecord.serviceId,
      // TODO: Pull real status from deployment health checks
      status: activeDeployment?.status === 'running' ? 'healthy' : 'unhealthy',
      // TODO: Pull real replica count from deployment spec
      replicas: activeDeployment?.container ? 1 : 0,
      // TODO: Pull real ownerId from deployment metadata
      ownerId: 'unknown',
      image: serviceDescriptor?.image || 'unknown',
      port: ingress?.containerPort || 0,
      serviceProxy: serviceProxy?.ingress || serviceProxy?.egress || [],
      hostPorts: hostPorts?.reduce((acc, hp) => {
        acc[hp.containerPort.toString()] = hp.hostPort;
        return acc;
      }, {} as Record<string, number>) || {},
      environment: environment || {},
      volumes: volumes || [],
    };

    ctx.body = enriched;
  };
}
