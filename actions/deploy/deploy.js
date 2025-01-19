// @ts-check
import fs from 'node:fs';

const unwrapEnv = (envName) => {
  const envValue = process.env[envName];
  if (!envValue) {
    throw new Error(`${envName} was not defined`);
  }
  return envValue;
}

const main = async () => {
  const serviceDescriptorPath = unwrapEnv('SERVICE_DESCRIPTOR_PATH');
  const paasBaseUrl = unwrapEnv('PAAS_BASE_URL');
  const deployToken = unwrapEnv('DEPLOY_TOKEN');

  const serviceDescriptor = fs.readFileSync(serviceDescriptorPath, { encoding: 'utf-8' });

  console.log(`Deploying ${serviceDescriptorPath} to ${paasBaseUrl}`);

  const response = await fetch(`${paasBaseUrl}/service/deploy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deployToken}`
    },
    body: JSON.stringify({
      serviceDescriptor: serviceDescriptor,
    }),
  });

  const responseBody = await response.json();

  console.log('Deploy success', responseBody);
}

main();