import { useState, useEffect } from 'react';
import { ServiceSummary } from '@homelab-paas/shared-contracts';

export function useFetchServices() {
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const response = await fetch('/api/services');
        
        if (!response.ok) {
          throw new Error(`Failed to fetch services: ${response.statusText}`);
        }
        
        const data = await response.json();
        setServices(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    // Small delay to simulate network request for consistency
    const timer = setTimeout(fetchServices, 500);

    return () => clearTimeout(timer);
  }, []);

  return { services, loading, error };
}