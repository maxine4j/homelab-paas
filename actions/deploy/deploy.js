// @ts-check
const fs = require('fs');
const core = require('@actions/core');

const unwrapEnv = (envName) => {
  const envValue = process.env[envName];
  if (!envValue) {
    throw new Error(`${envName} was not defined`);
  }
  return envValue;
}

const main = async () => {
  const serviceDescriptorPath = core.getInput('service-descriptor-path');
  const paasBaseUrl = core.getInput('paas-base-url');
  const deployToken = core.getInput('deploy-token');

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
