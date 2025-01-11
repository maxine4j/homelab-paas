import { exec } from 'node:child_process';
import { logger } from '../util/logger';

export const runCommand = (binaryPath: string, args: string[]): Promise<{
  stdout: string,
  stderr: string,
}> =>
  new Promise((resolve, reject) => {
    const command = `${binaryPath} ${args.map(arg => `"${arg}"`).join(' ')}`;
    
    exec(command, (error, stdout, stderr) => {
      const exitCode = error?.code ?? 0;

      if (exitCode !== 0) {
        logger.error({ command, exitCode }, 'Executed shell command');
        return reject(error)
      }

      logger.info({ command, exitCode }, 'Executed shell command');

      return resolve({
        stdout,
        stderr,
      });
    });
  });
