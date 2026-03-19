import { Link } from 'react-router-dom';
import { PageContainer } from '@/components/page';
import { useFetchServices } from '@/hooks/fetch-services';
import { CircleIcon } from '@/components/icons/circle';

// Helper function to map service status to icon color
const getStatusColor = (status: 'healthy' | 'unhealthy'): 'green' | 'red' => {
  return status === 'healthy' ? 'green' : 'red';
};

export const ServiceDirectoryPage = () => {
  const { services, loading, error } = useFetchServices();

  if (loading) {
    return <PageContainer>Loading services...</PageContainer>;
  }

  if (error) {
    return (
      <PageContainer>Failed to load services</PageContainer>
    );
  }

  return (
    <PageContainer>
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
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <Link
                    to={`/services/${service.id}`}
                    className="text-gray-200 hover:text-white hover:underline transition-colors"
                  >
                    {service.id}
                  </Link>
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
    </PageContainer>
  );
};
