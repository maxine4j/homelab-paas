import { bodyParser } from '@koa/bodyparser';
import Docker from 'dockerode';
import https from 'https';
import Koa from 'koa';
import { generate as generateShortUuid } from 'short-uuid';
import { DockerService } from './docker/service';
import { createAuthorizedPaasAdminRequiredMiddleware } from './domain/ingress/auth/middleware';
import { Oauth2ProviderRegistry } from './domain/ingress/auth/oauth-provider/registry';
import { createAuthRouter } from './domain/ingress/auth/router';
import { AuthService } from './domain/ingress/auth/service';
import { createReverseProxyMiddleware } from './domain/ingress/reverse-proxy/middleware';
import { DnsAcmeChallengeProviderRegistry } from './domain/ingress/tls/dns-challenge/registry';
import { TlsCertProvisionService } from './domain/ingress/tls/provision-service';
import { TlsCertRenewalTask } from './domain/ingress/tls/renewal-task';
import { NetworkService } from './domain/network/service';
import { createServiceProxyMiddleware } from './domain/network/service-proxy/middleware';
import { NetworkSyncTask } from './domain/network/sync-task';
import { DeploymentCleanupTask } from './domain/service/deployment/cleanup-task';
import {
  DeployTask,
  DeployTaskDescriptor,
} from './domain/service/deployment/deploy-task';
import {
  DeploymentRecord,
  DeploymentRepository,
} from './domain/service/deployment/repository';
import { createDeployRouter } from './domain/service/deployment/router';
import { DeployService } from './domain/service/deployment/service';
import { ServiceRecord, ServiceRepository } from './domain/service/repository';
import { createServiceRouter } from './domain/service/router';
import { SqliteKeyValueStore } from './kv-store/sqlite';
import { PeriodicTaskRunner } from './task/periodic';
import { InMemoryTaskQueue, QueueTaskRunner } from './task/queue';
import { StartupTaskRunner } from './task/startup';
import { TaskRunner } from './task/types';
import { ConfigReloadTask, ConfigService } from './util/config';
import { errorMiddleware } from './util/error';
import { readFile, writeFile } from './util/file';
import { createHealthCheckRouter } from './util/healthcheck';
import { Lifecycle } from './util/lifecycle';
import { createRequestLogger, logger } from './util/logger';
import { createRequestForwarder } from './util/request-forwarder';

export const start = async (lifecycle: Lifecycle) => {
  // ==================== dependencies ====================

  const uuid = () => generateShortUuid();
  const now = () => new Date();
  const configService = await ConfigService.create(readFile);
  const deploymentRepository = new DeploymentRepository(
    now,
    new SqliteKeyValueStore<DeploymentRecord>({
      databaseFilename: '/etc/homelab-paas/deployments.db',
      tableName: 'deployments',
    }),
  );
  const serviceRepository = new ServiceRepository(
    new SqliteKeyValueStore<ServiceRecord>({
      databaseFilename: '/etc/homelab-paas/services.db',
      tableName: 'services',
    }),
  );
  const authService = new AuthService(
    configService,
    new Oauth2ProviderRegistry(configService),
  );
  const dockerService = new DockerService(() => new Docker());
  const deployTaskQueue = new InMemoryTaskQueue<DeployTaskDescriptor>(uuid);
  const deployService = new DeployService(uuid, deployTaskQueue);
  const networkService = new NetworkService(
    dockerService,
    configService,
    serviceRepository,
    deploymentRepository,
  );
  const provisionCertificateHandler = new TlsCertProvisionService(
    configService,
    new DnsAcmeChallengeProviderRegistry(configService),
  );

  // ==================== primary paas web server ====================

  const paasKoaApp = new Koa()
    .use(createRequestLogger('paas'))
    .use(createAuthRouter(authService, configService).routes())
    .use(
      createReverseProxyMiddleware(
        serviceRepository,
        deploymentRepository,
        authService,
        createRequestForwarder(),
        configService,
      ),
    )
    .use(bodyParser())
    .use(createHealthCheckRouter().routes())
    .use(createDeployRouter(authService, deployService).routes())
    .use(
      createAuthorizedPaasAdminRequiredMiddleware(authService, configService),
    )
    .use(createServiceRouter(serviceRepository, deploymentRepository).routes())
    .use(errorMiddleware);

  const paasHttpsServer = https.createServer({}, paasKoaApp.callback());
  paasHttpsServer.listen(8443, () => {
    logger.info(`HTTPS server listening on 8443`);
  });
  lifecycle.registerShutdownHandler(() => {
    paasHttpsServer.close();
  });

  // ==================== redirect from http web server ====================

  const httpRedirectServer = new Koa()
    .use(createRequestLogger('http-redirect'))
    .use((ctx) => {
      const url = new URL(ctx.request.href);
      url.protocol = 'https:';
      ctx.redirect(url.toString());
    })
    .listen(8080, () => {
      logger.info(`HTTP redirect server listening on 8080`);
    });
  lifecycle.registerShutdownHandler(() => {
    httpRedirectServer.close();
  });

  // ==================== service proxy web server ====================

  const serviceProxyWebServer = new Koa()
    .use(createRequestLogger('service-proxy'))
    .use(
      createServiceProxyMiddleware(
        serviceRepository,
        deploymentRepository,
        dockerService,
        createRequestForwarder(),
      ),
    )
    .listen(9090, () => {
      logger.info(`Service proxy listening on 9090`);
    });
  lifecycle.registerShutdownHandler(() => {
    serviceProxyWebServer.close();
  });

  // ==================== tasks ====================

  const tasks: TaskRunner[] = [
    new QueueTaskRunner({
      lifecycle,
      queue: deployTaskQueue,
      idleDelayMs: 1_000 * 5,
      task: new DeployTask(
        dockerService,
        deploymentRepository,
        serviceRepository,
        networkService,
      ),
    }),
    new PeriodicTaskRunner({
      lifecycle,
      periodMs: 1_000 * 30,
      task: new DeploymentCleanupTask(
        dockerService,
        deploymentRepository,
        serviceRepository,
      ),
    }),
    new StartupTaskRunner(
      new NetworkSyncTask(networkService, serviceRepository),
    ),
    new PeriodicTaskRunner({
      lifecycle,
      periodMs: 1_000 * 60 * 60 * 24, // 1 day
      task: new TlsCertRenewalTask(
        provisionCertificateHandler,
        paasHttpsServer,
        writeFile,
        readFile,
        now,
      ),
    }),
    new PeriodicTaskRunner({
      lifecycle,
      periodMs: 1_000 * 15,
      task: new ConfigReloadTask(configService),
    }),
  ];

  tasks.forEach((task) => task.start());
};
