import { bodyParser } from '@koa/bodyparser';
import Docker from 'dockerode';
import Koa from 'koa';
import https from 'https';
import { generate as generateShortUuid } from 'short-uuid';
import { createDockerService } from './docker/service';
import { createAuthRouter } from './domain/ingress/auth/router';
import { createReverseProxyMiddleware } from './domain/ingress/reverse-proxy/middleware';
import { TlsCertProvisionService } from './domain/ingress/tls/provision-handler';
import { TlsCertRenewalTask } from './domain/ingress/tls/renewal-task';
import { DigitalOceanDnsAcmeChallengeProvider } from './domain/ingress/tls/dns-challenge/digitalocean';
import { createNetworkConnectHandler } from './domain/networking/connect-handler';
import { NetworkSyncTask } from './domain/networking/sync-task';
import { DeploymentCleanupTask } from './domain/service/deployment/cleanup-task';
import { createDeploymentDeployTask, DeployTask } from './domain/service/deployment/deploy-task';
import { createDeploymentRepository, DeploymentRecord } from './domain/service/deployment/repository';
import { createDeploymentStartHandler } from './domain/service/deployment/start-handler';
import { createServiceRepository, ServiceRecord } from './domain/service/repository';
import { createDeploymentRouter } from './domain/service/router';
import { createSqliteKeyValueStore } from './kv-store/sqlite';
import { PeriodicTaskRunner } from './task/periodic';
import { createInMemoryTaskQueue, createQueueTaskRunner } from './task/queue';
import { StartupTaskRunner } from './task/startup';
import { TaskRunner } from './task/types';
import { config } from './util/config';
import { errorMiddleware } from './util/error';
import { readFile, writeFile } from './util/file';
import { createHealthCheckRouter } from './util/healthcheck';
import { Lifecycle } from './util/lifecycle';
import { createRequestLogger, logger } from './util/logger';
import { createRequestForwarder } from './domain/ingress/reverse-proxy/forwarder';
import { AuthService } from './domain/ingress/auth/service';
import { GitHubOauth2Provider } from './domain/ingress/auth/oauth-provider/github';

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

  const authService = new AuthService(
    new GitHubOauth2Provider(config.rootDomain, config.auth.githubClientId, config.auth.githubClientSecret),
    config.auth.jwtSecret,
    config.auth.sessionLifetimeSeconds,
    config.auth.authorizedUsers
  );
  const dockerService = createDockerService(() => new Docker());
  const deployTaskQueue = createInMemoryTaskQueue<DeployTask>(uuid);
  const deploymentStartHandler = createDeploymentStartHandler(uuid, deployTaskQueue);
  const networkConnectHandler = createNetworkConnectHandler(dockerService);
  const provisionCertificateHandler = new TlsCertProvisionService(
    config.tls.notificationEmail,
    config.rootDomain,
    config.tls.letsencryptEnv,
    new DigitalOceanDnsAcmeChallengeProvider(
      config.tls.digitalocean.domain,
      config.tls.digitalocean.accessToken,
    ),
  );
  const reverseProxy = createReverseProxyMiddleware(
    serviceRepository, 
    deploymentRepository,
    authService,
    createRequestForwarder(),
    config.rootDomain,
    config.auth.cookieName,
  );

  const app = new Koa();
  app
    .use(createRequestLogger())
    .use(createAuthRouter(authService).routes())
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
      idleDelayMs: 1000 * 5,
      runTask: createDeploymentDeployTask(dockerService, deploymentRepository, serviceRepository, networkConnectHandler),
    }),
    new PeriodicTaskRunner(
      lifecycle,
      1_000 * 15,
      new DeploymentCleanupTask(dockerService, deploymentRepository, serviceRepository),
    ),
    new StartupTaskRunner(
      new NetworkSyncTask(networkConnectHandler, serviceRepository),
    ),
    new PeriodicTaskRunner(
      lifecycle,
      1_000 * 60 * 60 * 24, // 1 day
      new TlsCertRenewalTask(provisionCertificateHandler, httpsServer, writeFile, readFile, now),
    ),
  ]

  tasks.forEach(task => task.start());

  lifecycle.registerShutdownHandler(() => {
    httpsServer.close();
    httpServer.close();
  });
};
