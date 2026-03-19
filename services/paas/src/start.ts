import { bodyParser } from '@koa/bodyparser';
import Docker from 'dockerode';
import https from 'https';
import Koa from 'koa';
import { generate as generateShortUuid } from 'short-uuid';
import { DockerService } from './docker/docker-service';
import { createAuthorizedPaasAdminRequiredMiddleware } from './ingress/auth/auth-middleware';
import { Oauth2ProviderRegistry } from './ingress/auth/oauth-provider/registry';
import { createAuthRouter } from './ingress/auth/auth-router';
import { AuthService } from './ingress/auth/auth-service';
import { createPaasUiProxyMiddleware } from './ingress/reverse-proxy/paas-ui-proxy-middleware';
import { createReverseProxyMiddleware } from './ingress/reverse-proxy/reverse-proxy-middleware';
import { DnsAcmeChallengeProviderRegistry } from './ingress/tls/dns-challenge/registry';
import { TlsCertProvisionService } from './ingress/tls/cert-provision-service';
import { TlsCertRenewalTask } from './ingress/tls/cert-renewal-task';
import { NetworkService } from './network/network-service';
import { createServiceProxyMiddleware } from './network/service-proxy-middleware';
import { NetworkSyncTask } from './network/network-sync-task';
import { DeploymentCleanupTask } from './service/deployment/cleanup-task';
import {
  DeployTask,
  DeployTaskDescriptor,
} from './service/deployment/deploy-task';
import {
  DeploymentRecord,
  DeploymentRepository,
} from './service/deployment/repository';
import { createDeployRouter } from './service/deployment/router';
import { DeployService } from './service/deployment/service';
import { ServiceRecord, ServiceRepository } from './service/repository';
import { createServiceRouter } from './service/router';
import { SqliteKeyValueStore } from './store/sqlite';
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
    .use(createPaasUiProxyMiddleware(configService, createRequestForwarder()))
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
