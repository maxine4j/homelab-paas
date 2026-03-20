import { useCallback } from 'react';
import { useFetch } from './use-fetch'; // Assuming you have a useFetch hook created
import { ServiceSummary } from '@homelab-paas/shared-contracts';

/**
 * Fetch a single service detail by its ID
 * @param serviceId - The service ID to fetch
 * @returns The service summary data
 * @throws Error if the fetch fails or validation fails
 */
export const fetchServiceDetail = async (serviceId: string): Promise<ServiceSummary> => {
  const response = await fetch(`/api/services/${serviceId}`, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) throw new Error(`Failed to fetch service: ${response.statusText}`);
  
  const data = await response.json();
  
  // Simple validation - ensure we have required fields
  if (!data.id || !data.name) {
    throw new Error('Invalid service data received');
  }
  
  return data;
};

/**
 * Hook to fetch service details with loading and error states
 * @param serviceId - The service ID to fetch
 * @returns Object containing service, loading, and error states
 */
export const useServiceDetail = (serviceId: string) => {
  const result = useFetch<ServiceSummary | null>(
    useCallback(() => fetchServiceDetail(serviceId), [serviceId])
  );

  // Return the same structure but use the result from useFetch
  return {
    service: result.data,
    loading: result.loading,
    error: result.error,
  };
};
