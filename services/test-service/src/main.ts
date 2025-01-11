import Koa from 'koa';
import { createHealthCheckRouter } from './healthcheck';

const port = 8080;

const main = () => {
  const app = new Koa();

  app
    .use(createHealthCheckRouter().routes())
    .listen(port, () => {
      console.log(`Listening on ${port}`);
    });
}

main();
