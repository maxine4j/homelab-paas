import { Link } from 'react-router-dom';

export const Breadcrumbs = () => {
  return (
    <nav className="flex items-center space-x-2 text-sm text-gray-400 mb-6">
      <Link
        to="/services"
        className="hover:text-white transition-colors"
      >
        Services
      </Link>
      <span className="text-gray-600">/</span>
      <span className="text-white">Service Overview</span>
    </nav>
  );
};