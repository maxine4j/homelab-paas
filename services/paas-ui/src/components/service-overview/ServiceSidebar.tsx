import { Link } from 'react-router-dom';
import { useLocation } from 'react-router-dom';

export const ServiceSidebar = ({ serviceId }: { serviceId: string }) => {
  const location = useLocation();
  const currentPath = location.pathname;

  const isActive = (path: string) => currentPath === path;

  return (
    <aside className="w-64 flex-shrink-0 hidden md:block">
      <nav className="sticky top-4 space-y-1">
        <Link
          to={`/services/${serviceId}/overview`}
          className={`flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            isActive(`/services/${serviceId}/overview`)
              ? 'bg-[#a8e6cf] text-gray-900'
              : 'text-gray-300 hover:bg-[#1e1e1e] hover:text-white'
          }`}
        >
          Overview
        </Link>
        <Link
          to={`/services/${serviceId}/api-spec`}
          className={`flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            isActive(`/services/${serviceId}/api-spec`)
              ? 'bg-[#a8e6cf] text-gray-900'
              : 'text-gray-300 hover:bg-[#1e1e1e] hover:text-white'
          }`}
        >
          API Spec
        </Link>
        <Link
          to={`/services/${serviceId}/documentation`}
          className={`flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            isActive(`/services/${serviceId}/documentation`)
              ? 'bg-[#a8e6cf] text-gray-900'
              : 'text-gray-300 hover:bg-[#1e1e1e] hover:text-white'
          }`}
        >
          Documentation
        </Link>
        <Link
          to={`/services/${serviceId}/dependencies`}
          className={`flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            isActive(`/services/${serviceId}/dependencies`)
              ? 'bg-[#a8e6cf] text-gray-900'
              : 'text-gray-300 hover:bg-[#1e1e1e] hover:text-white'
          }`}
        >
          Dependencies
        </Link>
        <Link
          to={`/services/${serviceId}/deployments`}
          className={`flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            isActive(`/services/${serviceId}/deployments`)
              ? 'bg-[#a8e6cf] text-gray-900'
              : 'text-gray-300 hover:bg-[#1e1e1e] hover:text-white'
          }`}
        >
          Deployments
        </Link>
      </nav>
    </aside>
  );
};
