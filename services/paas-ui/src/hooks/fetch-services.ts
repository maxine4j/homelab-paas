import { useState, useEffect } from 'react';

export interface ServiceMock {
  id: string;
  name: string;
}

const mockServices: ServiceMock[] = [
  { id: 'auth-svc', name: 'Authentication Service' },
  { id: 'user-svc', name: 'User Profile Service' },
  { id: 'msg-broker', name: 'Message Broker Proxy' },
  { id: 'monolith', name: 'The Monolith' },
  { id: 'event-src', name: 'Event Sourcing Service' },
  { id: 'notify-dispatch', name: 'Notification Dispatcher' },
  { id: 'bouncer', name: 'The Bouncer' },
  { id: 'validator', name: 'The Validator' },
  { id: 'legacy-db', name: 'Legacy Database Wrapper' },
  { id: 'session-mgr', name: 'Session Manager' },
  { id: 'aggregator', name: 'The Aggregator' },
  { id: 'sieve', name: 'The Sieve' },
  { id: 'metrics-svc', name: 'Metrics Collector' },
  { id: 'decoupler', name: 'The Decoupler' },
  { id: 'rate-limit', name: 'Rate Limiter' },
  { id: 'cache-layer', name: 'Caching Layer' },
  { id: 'feature-flags', name: 'Feature Flag Service' },
  { id: 'sharder', name: 'The Sharder' },
  { id: 'billing-svc', name: 'Billing Service' },
  { id: 'data-lake', name: 'Data Lake Ingestor' },
];

export function useFetchServices() {
  const [services, setServices] = useState<ServiceMock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Simulate network delay
    const timer = setTimeout(() => {
      try {
        const sorted = [...mockServices].sort((a, b) => a.name.localeCompare(b.name));
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
