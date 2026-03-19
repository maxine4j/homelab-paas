import { ServiceMock } from '@/hooks/fetch-services';

interface ServiceHeaderProps {
  service: ServiceMock;
}

export const ServiceHeader = ({ service }: ServiceHeaderProps) => {
  return (
    <div className="mb-8">
      <div className="flex items-center space-x-3">
        <div
          className={`w-3 h-3 rounded-full ${
            service.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <h1 className="text-4xl font-bold text-white">{service.id}</h1>
      </div>
      <p className="text-gray-400 mt-2">Owner ID: {service.ownerId}</p>
    </div>
  );
};