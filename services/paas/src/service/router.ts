import Router from '@koa/router';
import { ServiceQueryHandler } from './service-query-handler';

export const createServiceRouter = (
  serviceQueryHandler: ServiceQueryHandler,
) => {
  return new Router()
    .get('/api/services/:serviceId', serviceQueryHandler.getService)
    .get('/api/services', serviceQueryHandler.getAllServices);
};
