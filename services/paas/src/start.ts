import { bodyParser } from '@koa/bodyparser';
import Docker from 'dockerode';
import Koa from 'koa';
import https from 'https';
import { generate as generateShortUuid } from 'short-uuid';
import { createDockerService } from './docker/service';
import { createAuthRouter } from './domain/ingress/auth/router';
import { createReverseProxyMiddleware } from './domain/ingress/reverse-proxy/middleware';
import { createTlsCertificateProvisionHandler } from './domain/ingress/tls/provision-handler';
import { createTlsCertRenewalTask } from './domain/ingress/tls/renewal-task';
import { createDigitalOceanDnsAcmeChallengeProvider } from './domain/ingress/tls/dns-challenge/digitalocean';
import { createNetworkConnectHandler } from './domain/networking/connect-handler';
import { createNetworkSyncTask } from './domain/networking/sync-task';
import { createDeploymentCleanupTask } from './domain/service/deployment/cleanup-task';
import { createDeploymentDeployTask, DeploymentDeployTask } from './domain/service/deployment/deploy-task';
import { createDeploymentRepository, DeploymentRecord } from './domain/service/deployment/repository';
import { createDeploymentStartHandler } from './domain/service/deployment/start-handler';
import { createServiceRepository, ServiceRecord } from './domain/service/repository';
import { createDeploymentRouter } from './domain/service/router';
import { createSqliteKeyValueStore } from './kv-store/sqlite';
import { createPeriodicTaskRunner } from './task/periodic';
import { createInMemoryTaskQueue, createQueueTaskRunner } from './task/queue';
import { createStartupTaskRunner } from './task/startup';
import { TaskRunner } from './task/types';
import { config } from './util/config';
import { errorMiddleware } from './util/error';
import { readFile, writeFile } from './util/file';
import { createHealthCheckRouter } from './util/healthcheck';
import { Lifecycle } from './util/lifecycle';
import { createRequestLogger, logger } from './util/logger';
import { readFileSync } from 'fs';
import { createGetAuthenticatedUser } from './domain/ingress/auth/authn';
import { createUserAuthorizationChecker } from './domain/ingress/auth/authz';
import { createRequestForwarder } from './domain/ingress/reverse-proxy/forward';
import { getLoginUrl } from './domain/ingress/auth/oauth';

export const start = (lifecycle: Lifecycle) => {
  const uuid = () => generateShortUuid();
  const now = () => new Date();

  const deploymentKvStore = createSqliteKeyValueStore<DeploymentRecord>({
    databaseFilename: '/etc/homelab-paas/deployments.db',
    tableName: 'deployments',
  });
  const deploymentRepository = createDeploymentRepository(now, deploymentKvStore);

  const serviceKvStore = createSqliteKeyValueStore<ServiceRecord>({
    databaseFilename: '/etc/homelab-paas/services.db',
    tableName: 'services',
  });
  const serviceRepository = createServiceRepository(serviceKvStore);

  const dockerService = createDockerService(() => new Docker());
  const deployTaskQueue = createInMemoryTaskQueue<DeploymentDeployTask>(uuid);
  const deploymentStartHandler = createDeploymentStartHandler(uuid, deployTaskQueue);
  const networkConnectHandler = createNetworkConnectHandler(dockerService);
  const provisionCertificateHandler = createTlsCertificateProvisionHandler(
    config.tls.notificationEmail,
    config.rootDomain,
    config.tls.letsencryptEnv,
    createDigitalOceanDnsAcmeChallengeProvider(
      config.tls.digitalocean.domain,
      config.tls.digitalocean.accessToken,
    ),
  );
  const reverseProxy = createReverseProxyMiddleware(
    serviceRepository, 
    deploymentRepository,
    createGetAuthenticatedUser(),
    createUserAuthorizationChecker(config.auth.authorizedUsers),
    createRequestForwarder(),
    config.rootDomain,
    getLoginUrl,
  );

  const app = new Koa();
  app
    .use(createRequestLogger())
    .use(createAuthRouter().routes())
    .use(reverseProxy)
    .use(bodyParser())
    .use(createHealthCheckRouter().routes())
    .use(createDeploymentRouter(deploymentStartHandler).routes())
    .use(errorMiddleware)
    .use((ctx) => {
      ctx.body = `
        <html>
          <h1>paas home</h1>
        </html>
      `
    });

  const httpsServer = https.createServer({}, app.callback());
  httpsServer.listen(config.httpsPort, () => {
    logger.info(`Listening on ${config.httpsPort}`);
  });
  
  const httpServer = new Koa()
    .use((ctx) => {
      const url = new URL(ctx.request.href);
      url.protocol = 'https:';
      ctx.redirect(url.toString());
    })
    .listen(config.httpPort, () => {
      logger.info(`Listening on ${config.httpPort}`);
    });

  const tasks: TaskRunner[] = [
    createQueueTaskRunner({
      lifecycle,
      queue: deployTaskQueue,
      idleDelayMs: 5_000,
      runTask: createDeploymentDeployTask(dockerService, deploymentRepository, serviceRepository, networkConnectHandler),
    }),
    createPeriodicTaskRunner({
      lifecycle,
      periodMs: 15_000,
      runTask: createDeploymentCleanupTask(dockerService, deploymentRepository, serviceRepository),
    }),
    createStartupTaskRunner({
      runTask: createNetworkSyncTask(networkConnectHandler, serviceRepository),
    }),
    createPeriodicTaskRunner({
      lifecycle,
      periodMs: 1_000 * 60 * 60 * 24, // 1 day
      runTask: createTlsCertRenewalTask(provisionCertificateHandler, httpsServer, writeFile, readFile, now),
    }),
  ]

  tasks.forEach(task => task.start());

  lifecycle.registerShutdownHandler(() => {
    httpsServer.close();
    httpServer.close();
  });
};
