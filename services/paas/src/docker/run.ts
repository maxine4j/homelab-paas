import { runCommand } from '../util/exec';
import { logger } from '../util/logger';

const DOCKER_BINARY_PATH = '/usr/local/bin/docker';

export const kubectlAnnotate = async (args: {
  resourceType: string,
  resourceName: string,
  annotation: [string, string],
}) => {
  const [annotationKey, annotationValue] = args.annotation;

  const { stdout, stderr } = await runCommand(KUBECTL_BINARY_PATH, [
    'annotate', args.resourceType, args.resourceName,
    `"${annotationKey}"="${annotationValue}"`, '--overwrite',
  ]);
  logger.info({ stdout, stderr, ...args }, 'Annotated resource');
}
