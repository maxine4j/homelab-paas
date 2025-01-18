import { bodyParser } from '@koa/bodyparser';
import Docker from 'dockerode';
import Koa from 'koa';
import https from 'https';
import { generate as generateShortUuid } from 'short-uuid';
import { DockerService } from './docker/service';
import { createAuthRouter } from './domain/ingress/auth/router';
import { createReverseProxyMiddleware } from './domain/ingress/reverse-proxy/middleware';
import { TlsCertProvisionService } from './domain/ingress/tls/provision-service';
import { TlsCertRenewalTask } from './domain/ingress/tls/renewal-task';
import { NetworkService } from './domain/network/service';
import { NetworkSyncTask } from './domain/network/sync-task';
import { DeploymentCleanupTask } from './domain/service/deployment/cleanup-task';
import {
  DeployTask,
  DeployTaskDescriptor,
} from './domain/service/deployment/deploy-task';
import {
  DeploymentRepository,
  DeploymentRecord,
} from './domain/service/deployment/repository';
import { DeployService } from './domain/service/deployment/service';
import { ServiceRepository, ServiceRecord } from './domain/service/repository';
import { ServiceRouter } from './domain/service/router';
import { SqliteKeyValueStore } from './kv-store/sqlite';
import { PeriodicTaskRunner } from './task/periodic';
import { InMemoryTaskQueue, QueueTaskRunner } from './task/queue';
import { StartupTaskRunner } from './task/startup';
import { TaskRunner } from './task/types';
import { ConfigService } from './util/config';
import { errorMiddleware } from './util/error';
import { readFile, readFileSync, writeFile } from './util/file';
import { createHealthCheckRouter } from './util/healthcheck';
import { Lifecycle } from './util/lifecycle';
import { createRequestLogger, logger } from './util/logger';
import { createRequestForwarder } from './domain/ingress/reverse-proxy/forwarder';
import { AuthService } from './domain/ingress/auth/service';
import { DnsAcmeChallengeProviderRegistry } from './domain/ingress/tls/dns-challenge/registry';
import { Oauth2ProviderRegistry } from './domain/ingress/auth/oauth-provider/registry';

export const start = (lifecycle: Lifecycle) => {
  const uuid = () => generateShortUuid();
  const now = () => new Date();

  const configService = new ConfigService(readFileSync);

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
  const networkService = new NetworkService(dockerService, configService);
  const provisionCertificateHandler = new TlsCertProvisionService(
    configService,
    new DnsAcmeChallengeProviderRegistry(configService),
  );
  const reverseProxy = createReverseProxyMiddleware(
    serviceRepository,
    deploymentRepository,
    authService,
    createRequestForwarder(),
    configService,
  );

  const app = new Koa();
  app
    .use(createRequestLogger())
    .use(createAuthRouter(authService, configService).routes())
    .use(reverseProxy)
    .use(bodyParser())
    .use(createHealthCheckRouter().routes())
    .use(new ServiceRouter(deployService).routes())
    .use(errorMiddleware)
    .use((ctx) => {
      ctx.body = `
        <html>
          <h1>paas home</h1>
        </html>
      `;
    });

  const httpsServer = https.createServer({}, app.callback());
  httpsServer.listen(8443, () => {
    logger.info(`Listening on 8443`);
  });

  const httpServer = new Koa()
    .use((ctx) => {
      const url = new URL(ctx.request.href);
      url.protocol = 'https:';
      ctx.redirect(url.toString());
    })
    .listen(8080, () => {
      logger.info(`Listening on 8080`);
    });

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
      periodMs: 1_000 * 15,
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
        httpsServer,
        writeFile,
        readFile,
        now,
      ),
    }),
  ];

  tasks.forEach((task) => task.start());

  lifecycle.registerShutdownHandler(() => {
    httpsServer.close();
    httpServer.close();
  });
};
