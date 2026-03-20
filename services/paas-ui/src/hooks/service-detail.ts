import { useState, useEffect } from 'react';
import { ServiceMock } from './fetch-services';

export function useServiceDetail(serviceId: string) {
  const [service, setService] = useState<ServiceMock | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Simulate network delay
    const timer = setTimeout(() => {
      try {
        const foundService = mockServices.find((s) => s.id === serviceId);
        if (foundService) {
          setService(foundService);
        } else {
          setError(new Error(`Service "${serviceId}" not found`));
        }
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [serviceId]);

  return { service, loading, error };
}

const mockServices: ServiceMock[] = [
  {
    id: 'bingo',
    status: 'healthy',
    replicas: 2,
    ownerId: 'user123',
    image: 'bingo-app:latest',
    port: 8080,
    serviceProxy: ['api.bingo', 'bingo-api'],
    hostPorts: { '8080': 8080 },
    environment: { NODE_ENV: 'production', API_KEY: 'secret' },
    volumes: [],
  },
  {
    id: 'papaya',
    status: 'healthy',
    replicas: 1,
    ownerId: 'user456',
    image: 'papaya-app:latest',
    port: 3000,
    serviceProxy: ['api.papaya'],
    hostPorts: { '3000': 3000 },
    environment: { DATABASE_URL: 'postgres://localhost:5432' },
    volumes: [
      { containerPath: '/data', hostPath: '/var/lib/papaya' },
    ],
  },
  {
    id: 'magic-baby-service',
    status: 'healthy',
    replicas: 3,
    ownerId: 'user789',
    image: 'magic-baby:latest',
    port: 8081,
    serviceProxy: ['magic-baby-api'],
    hostPorts: { '8081': 8081 },
    environment: {},
    volumes: [],
  },
  {
    id: 'lmnop',
    status: 'unhealthy',
    replicas: 0,
    ownerId: 'user123',
    image: 'lmnop-app:latest',
    port: 5000,
    serviceProxy: ['api.lmnop'],
    hostPorts: { '5000': 5000 },
    environment: {},
    volumes: [],
  },
  {
    id: 'raccoon',
    status: 'healthy',
    replicas: 1,
    ownerId: 'user456',
    image: 'raccoon-app:latest',
    port: 9000,
    serviceProxy: ['raccoon-api'],
    hostPorts: { '9000': 9000 },
    environment: {},
    volumes: [],
  },
  {
    id: 'wngman',
    status: 'unhealthy',
    replicas: 0,
    ownerId: 'user789',
    image: 'wngman-app:latest',
    port: 8082,
    serviceProxy: ['api.wngman'],
    hostPorts: { '8082': 8082 },
    environment: {},
    volumes: [],
  },
  {
    id: 'rgs',
    status: 'healthy',
    replicas: 2,
    ownerId: 'user123',
    image: 'rgs-app:latest',
    port: 8083,
    serviceProxy: ['api.rgs'],
    hostPorts: { '8083': 8083 },
    environment: {},
    volumes: [],
  },
  {
    id: 'brb-dll',
    status: 'healthy',
    replicas: 1,
    ownerId: 'user456',
    image: 'brb-dll-app:latest',
    port: 8084,
    serviceProxy: ['api.brb-dll'],
    hostPorts: { '8084': 8084 },
    environment: {},
    volumes: [],
  },
  {
    id: 'ringo2',
    status: 'unhealthy',
    replicas: 0,
    ownerId: 'user789',
    image: 'ringo2-app:latest',
    port: 8085,
    serviceProxy: ['api.ringo2'],
    hostPorts: { '8085': 8085 },
    environment: {},
    volumes: [],
  },
  {
    id: 'pcp',
    status: 'healthy',
    replicas: 3,
    ownerId: 'user123',
    image: 'pcp-app:latest',
    port: 8086,
    serviceProxy: ['api.pcp'],
    hostPorts: { '8086': 8086 },
    environment: {},
    volumes: [],
  },
  {
    id: 'bls',
    status: 'healthy',
    replicas: 1,
    ownerId: 'user456',
    image: 'bls-app:latest',
    port: 8087,
    serviceProxy: ['api.blS'],
    hostPorts: { '8087': 8087 },
    environment: {},
    volumes: [],
  },
  {
    id: 'galactus',
    status: 'unhealthy',
    replicas: 0,
    ownerId: 'user789',
    image: 'galactus-app:latest',
    port: 8088,
    serviceProxy: ['api.galactus'],
    hostPorts: { '8088': 8088 },
    environment: {},
    volumes: [],
  },
  {
    id: 'eks',
    status: 'healthy',
    replicas: 2,
    ownerId: 'user123',
    image: 'eks-app:latest',
    port: 8089,
    serviceProxy: ['api.eks'],
    hostPorts: { '8089': 8089 },
    environment: {},
    volumes: [],
  },
  {
    id: 'omega-star',
    status: 'healthy',
    replicas: 1,
    ownerId: 'user456',
    image: 'omega-star-app:latest',
    port: 8090,
    serviceProxy: ['api.omega-star'],
    hostPorts: { '8090': 8090 },
    environment: {},
    volumes: [],
  },
];