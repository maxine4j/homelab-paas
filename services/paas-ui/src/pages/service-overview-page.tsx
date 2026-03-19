import { useParams } from 'react-router-dom';
import { PageContainer } from '@/components/page';
import { Breadcrumbs } from '@/components/service-overview/Breadcrumbs';
import { ServiceSidebar } from '@/components/service-overview/ServiceSidebar';
import { ServiceHeader } from '@/components/service-overview/ServiceHeader';
import { DetailCard } from '@/components/service-overview/DetailCard';
import { useServiceDetail } from '@/hooks/use-service-detail';

export const ServiceOverviewPage = () => {
  const { serviceId } = useParams<{ serviceId: string }>();
  const { service, loading, error } = useServiceDetail(serviceId || '');

  if (loading) {
    return (
      <PageContainer>
        <div className="text-gray-400">Loading service details...</div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <div className="text-red-400">Error: {error.message}</div>
      </PageContainer>
    );
  }

  if (!service) {
    return (
      <PageContainer>
        <div className="text-gray-400">Service not found</div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Breadcrumbs serviceId={service.id} />
      <div className="flex">
        <ServiceSidebar serviceId={service.id} />
        <main className="flex-1 min-w-0">
          <ServiceHeader service={service} />
          <DetailCard service={service} />
          
          {/* Placeholder sections for other navigation items */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">API Spec</h2>
            <div className="bg-[#1e1e1e] rounded-lg border border-white/10 p-6">
              <p className="text-gray-400">API specification documentation</p>
            </div>
          </div>
          
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">Documentation</h2>
            <div className="bg-[#1e1e1e] rounded-lg border border-white/10 p-6">
              <p className="text-gray-400">Service documentation and guides</p>
            </div>
          </div>
          
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">Dependencies</h2>
            <div className="bg-[#1e1e1e] rounded-lg border border-white/10 p-6">
              <p className="text-gray-400">Service dependencies and dependencies</p>
            </div>
          </div>
          
          <div>
            <h2 className="text-2xl font-bold text-white mb-4">Deployments</h2>
            <div className="bg-[#1e1e1e] rounded-lg border border-white/10 p-6">
              <p className="text-gray-400">Deployment history and configurations</p>
            </div>
          </div>
        </main>
      </div>
    </PageContainer>
  );
};