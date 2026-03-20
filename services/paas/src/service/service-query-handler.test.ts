import { ServiceQueryHandler } from './service-query-handler';
import { RouterContext } from '@koa/router';
import { ServiceRepository } from './repository';
import { DeploymentRepository } from './deployment/repository';

describe('ServiceQueryHandler', () => {
  let handler: ServiceQueryHandler;
  let mockServiceRepo: jest.Mocked<Partial<ServiceRepository>>;
  let mockDeploymentRepo: jest.Mocked<Partial<DeploymentRepository>>;

  beforeEach(() => {
    mockServiceRepo = {
      queryAllServices: jest.fn(),
      queryService: jest.fn(),
    };
    mockDeploymentRepo = {
      queryByService: jest.fn(),
    };
    handler = new ServiceQueryHandler(
      mockServiceRepo as unknown as ServiceRepository,
      mockDeploymentRepo as unknown as DeploymentRepository
    );
  });

  describe('getAllServices', () => {
    it('should return enriched services', async () => {
      mockServiceRepo.queryAllServices?.mockResolvedValue([
        { serviceId: 'test-service', createdAt: new Date() }
      ]);
      mockDeploymentRepo.queryByService?.mockResolvedValue([
        {
          id: 'dep-id',
          serviceId: 'test-service',
          status: 'running',
          container: { id: 'container-id', status: 'running' },
          createdAt: new Date(),
          serviceDescriptor: {
            image: 'test-image',
            networking: { ingress: { containerPort: 8080 } },
          },
        } as any,
      ]);

      const ctx: any = { body: null };
      await handler.getAllServices(ctx as RouterContext);

      expect(ctx.body).toEqual([
        {
          id: 'test-service',
          status: 'healthy',
          replicas: 1,
          ownerId: 'unknown',
          image: 'test-image',
          port: 8080,
          serviceProxy: [],
          hostPorts: {},
          environment: {},
          volumes: [],
        },
      ]);
      expect(mockServiceRepo.queryAllServices).toHaveBeenCalledTimes(1);
      expect(mockDeploymentRepo.queryByService).toHaveBeenCalledWith('test-service');
    });

    it('should return empty array when no services exist', async () => {
      mockServiceRepo.queryAllServices?.mockResolvedValue([]);
      
      const ctx: any = { body: null };
      await handler.getAllServices(ctx as RouterContext);

      expect(ctx.body).toEqual([]);
    });
  });

  describe('getService', () => {
    it('should return 404 if service not found', async () => {
      mockServiceRepo.queryService?.mockResolvedValue(undefined);
      const ctx: any = { params: { serviceId: 'unknown-service' }, status: 200 };
      
      await handler.getService(ctx as RouterContext);

      expect(ctx.status).toBe(404);
    });

    it('should return 404 if no serviceId provided', async () => {
      mockServiceRepo.queryService?.mockResolvedValue(undefined);
      const ctx: any = { params: {}, status: 200 };
      
      await handler.getService(ctx as RouterContext);
      
      expect(ctx.status).toBe(404);
    });

    it('should return enriched service', async () => {
      mockServiceRepo.queryService?.mockResolvedValue({ serviceId: 'test-service', createdAt: new Date() });
      mockDeploymentRepo.queryByService?.mockResolvedValue([
        {
          id: 'dep-id',
          serviceId: 'test-service',
          status: 'running',
          container: { id: 'container-id', status: 'running' },
          createdAt: new Date(),
          serviceDescriptor: {
            image: 'test-image',
            networking: { ingress: { containerPort: 8080 } },
          },
        } as any,
      ]);

      const ctx: any = { params: { serviceId: 'test-service' }, body: null };
      await handler.getService(ctx as RouterContext);

      expect(ctx.body).toEqual({
        id: 'test-service',
        status: 'healthy',
        replicas: 1,
        ownerId: 'unknown',
        image: 'test-image',
        port: 8080,
        serviceProxy: [],
        hostPorts: {},
        environment: {},
        volumes: [],
      });
      expect(mockServiceRepo.queryService).toHaveBeenCalledWith('test-service');
    });
  });
});
