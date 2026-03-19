import { useState, useEffect } from 'react';

export interface ServiceMock {
  id: string;
}

const mockServices: ServiceMock[] = [
  { id: 'bingo' },
  { id: 'papaya' },
  { id: 'magic-baby-service' },
  { id: 'lmnop' },
  { id: 'raccoon' },
  { id: 'wngman' },
  { id: 'rgs' },
  { id: 'brb-dll' },
  { id: 'ringo2' },
  { id: 'pcp' },
  { id: 'bls' },
  { id: 'galactus' },
  { id: 'eks' },
  { id: 'omega-star' },
];

export function useFetchServices() {
  const [services, setServices] = useState<ServiceMock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
      // Simulate network delay
      const timer = setTimeout(() => {
        try {
          const sorted = [...mockServices].sort((a, b) => a.id.localeCompare(b.id));
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
