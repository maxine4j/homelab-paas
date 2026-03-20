import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Result type from useFetch hook
 */
export interface FetchResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Generic useFetch hook for making API calls
 * @param fetchFn - The async fetch function to execute
 * @returns Object containing data, loading, error states and refetch method
 */
export const useFetch = <T>(fetchFn: () => Promise<T>): FetchResult<T> => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Create a ref to track if we should still update state
  const mountedRef = useRef(true);

  // Create executeFetch function that will be stable
  const executeFetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchFn();
      if (mountedRef.current) {
        setData(result);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [fetchFn]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    executeFetch();

    return () => {
      mountedRef.current = false;
    };
  }, [executeFetch]);

  // Refetch function
  const refetch = useCallback(() => {
    executeFetch();
  }, [executeFetch]);

  return { data, loading, error, refetch };
};
