import Router, { RouterContext } from '@koa/router';
import {
  DeploymentRecord,
  DeploymentRepository,
} from './deployment/repository';
import { ServiceRepository } from './repository';
import { ServiceDescriptor } from './service-descriptor';

// Service summary DTO matching frontend expectations
export interface ServiceSummary {
  id: string;
  status: 'healthy' | 'unhealthy';
  replicas: number;
  ownerId: string;
  image: string;
  port: number;
  serviceProxy: string[];
  hostPorts: Record<string, number>;
  environment: Record<string, string>;
  volumes: Array<{ containerPath: string; hostPath: string }>;
}

export const createServiceRouter = (
  serviceRepository: ServiceRepository,
  deploymentRepository: DeploymentRepository,
) => {
  const getServiceSummary = async (ctx: RouterContext) => {
    const serviceId = ctx.params['serviceId'];
    const serviceRecord = await serviceRepository.queryService(serviceId ?? '');
    if (!serviceId || !serviceRecord) {
      ctx.status = 404;
      return;
    }

    const deploymentRecords =
      await deploymentRepository.queryByService(serviceId);

    const recentDeployments = deploymentRecords
      .sort(byDeploymentCreatedAt)
      .slice(0, 10);

    ctx.body = {
      service: serviceRecord,
      deployments: recentDeployments,
    };
  };

  const getAllServices = async (ctx: RouterContext) => {
    const services = await serviceRepository.queryAllServices();
    
    const deploymentsMap = new Map<string, DeploymentRecord[]>();
    const deploymentPromises = services.map(async (service) => {
      const deployments = await deploymentRepository.queryByService(service.serviceId);
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

  return new Router()
    .get('/service/:serviceId/summary', getServiceSummary)
    .get('/services', getAllServices);
};

const byDeploymentCreatedAt = (
  deploymentA: DeploymentRecord,
  deploymentB: DeploymentRecord,
) => {
  return (
    new Date(deploymentB.createdAt).getTime() -
    new Date(deploymentA.createdAt).getTime()
  );
};
