import { ServiceMock } from '@/hooks/fetch-services';

interface DetailCardProps {
  service: ServiceMock;
}

export const DetailCard = ({ service }: DetailCardProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
      {/* Health Status Card */}
      <div className="bg-[#1e1e1e] rounded-lg border border-white/10 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Health Status</h3>
        <div className="flex items-center space-x-3">
          <div
            className={`w-4 h-4 rounded-full ${
              service.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span
            className={`text-lg ${
              service.status === 'healthy' ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {service.status.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Owner ID Card */}
      <div className="bg-[#1e1e1e] rounded-lg border border-white/10 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Owner ID</h3>
        <p className="text-gray-300 text-lg">{service.ownerId}</p>
      </div>

      {/* Image/Container Info Card */}
      <div className="bg-[#1e1e1e] rounded-lg border border-white/10 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Image</h3>
        <p className="text-gray-300 text-lg">{service.image}</p>
      </div>

      {/* Replicas/Port Card */}
      <div className="bg-[#1e1e1e] rounded-lg border border-white/10 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Replicas & Port</h3>
        <div className="space-y-2">
          <div>
            <span className="text-gray-400">Replicas: </span>
            <span className="text-white">{service.replicas}</span>
          </div>
          <div>
            <span className="text-gray-400">Port: </span>
            <span className="text-white">{service.port}</span>
          </div>
        </div>
      </div>
    </div>
  );
};