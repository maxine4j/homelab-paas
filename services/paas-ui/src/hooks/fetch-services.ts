import { useState, useEffect } from 'react';

export interface ServiceMock {
  id: string;
  status: 'healthy' | 'unhealthy';
  replicas: number;
  ownerId: string;
}

const mockServices: ServiceMock[] = [
  { id: 'bingo', status: 'healthy', replicas: 2, ownerId: 'user123' },
  { id: 'papaya', status: 'healthy', replicas: 1, ownerId: 'user456' },
  { id: 'magic-baby-service', status: 'healthy', replicas: 3, ownerId: 'user789' },
  { id: 'lmnop', status: 'unhealthy', replicas: 0, ownerId: 'user123' },
  { id: 'raccoon', status: 'healthy', replicas: 1, ownerId: 'user456' },
  { id: 'wngman', status: 'unhealthy', replicas: 0, ownerId: 'user789' },
  { id: 'rgs', status: 'healthy', replicas: 2, ownerId: 'user123' },
  { id: 'brb-dll', status: 'healthy', replicas: 1, ownerId: 'user456' },
  { id: 'ringo2', status: 'unhealthy', replicas: 0, ownerId: 'user789' },
  { id: 'pcp', status: 'healthy', replicas: 3, ownerId: 'user123' },
  { id: 'bls', status: 'healthy', replicas: 1, ownerId: 'user456' },
  { id: 'galactus', status: 'unhealthy', replicas: 0, ownerId: 'user789' },
  { id: 'eks', status: 'healthy', replicas: 2, ownerId: 'user123' },
  { id: 'omega-star', status: 'healthy', replicas: 1, ownerId: 'user456' },
];

export function useFetchServices() {
  const [services, setServices] = useState<ServiceMock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Simulate network delay
    const timer = setTimeout(() => {
      try {
        const sorted = [...mockServices].sort((a, b) =>
          a.id.localeCompare(b.id),
        );
        // Return only the first 15 alphabetically sorted services
        setServices(sorted.slice(0, 15));
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  return { services, loading, error };
}
