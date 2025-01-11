import Docker from 'dockerode';

export interface DockerRunService {
  (args: { image: string }): Promise<void>
}

export const createDockerRunService = (): DockerRunService => 
  async ({ image }) => {
    const docker = new Docker();

    const result = await docker.run(image, [], process.stdout);
  }
