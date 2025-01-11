const unwrapEnv = (envVarName: string): string => {
  const value = process.env[envVarName];
  if (typeof value !== 'string') throw Error(`Env var missing: ${envVarName}`);
  return value;
}

export const config = {
  port: 8080,
};
