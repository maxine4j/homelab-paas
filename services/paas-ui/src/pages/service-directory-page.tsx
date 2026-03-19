import { PageContianer } from '@/components/page';
import { useFetchServices } from '@/hooks/fetch-services';
import { CircleIcon } from '@/components/icons/circle';

// Helper function to map service status to icon color
const getStatusColor = (status: 'healthy' | 'unhealthy'): 'green' | 'red' => {
  return status === 'healthy' ? 'green' : 'red';
};

export const ServiceDirectoryPage = () => {
  const { services, loading, error } = useFetchServices();

  if (loading) {
    return <PageContianer title="Services">Loading services...</PageContianer>;
  }

  if (error) {
    return (
      <PageContianer title="Services">Failed to load services</PageContianer>
    );
  }

  return (
    <PageContianer title="Services">
      <div className="min-w-full divide-y divide-white/10">
        <table className="min-w-full divide-y divide-white/10">
          <thead className="bg-[#1e1e1e]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Owner ID
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Replicas
              </th>
            </tr>
          </thead>
          <tbody className="bg-[#1e1e1e] divide-y divide-white/10">
            {services.map((service) => (
              <tr key={service.id} className="hover:bg-[#a8e6cf]/10 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <CircleIcon color={getStatusColor(service.status)} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-200">
                  {service.id}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                  {service.ownerId}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                  {service.replicas}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageContianer>
  );
};
