export interface ServiceSummary {
  id: string;
  status: 'healthy' | 'unhealthy';
  replicas: number;
  ownerId: string;
  image: string;
  port: number;
  serviceProxy: string[];
  hostPorts: Record<string, number>;
  environment: Record<string, string>;
  volumes: Array<{ containerPath: string; hostPath: string }>;
}