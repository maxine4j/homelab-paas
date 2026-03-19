import { NavLink, Link } from 'react-router-dom';
import { useFetchServices } from '../../hooks/fetch-services';

export function TopNav() {
  const { services, loading, error } = useFetchServices();

  return (
    <nav className="flex items-center justify-between bg-[#1e1e1e] px-4 sm:px-6 lg:px-8 h-16 rounded-xl shadow-lg shadow-black/30 mt-4 mb-2 mx-4 sm:mx-6 lg:mx-auto max-w-7xl font-sans sticky top-4 z-50">
      <div className="text-white text-xl font-semibold hover:text-[#a8e6cf] transition-colors">
        <Link to="/">PaaS UI</Link>
      </div>
      <ul className="flex items-center gap-2 h-full list-none m-0 p-0">
        <li className="h-full flex items-center">
          <NavLink
            to="/"
            className={({ isActive }) => (isActive ? 'bg-[#a8e6cf]/10 text-[#a8e6cf] px-4 py-2 rounded-lg font-medium transition-all' : 'text-gray-200 px-4 py-2 rounded-lg font-medium hover:bg-[#a8e6cf]/10 hover:text-[#a8e6cf] transition-all')}
            end
          >
            Dashboard
          </NavLink>
        </li>
        <li className="h-full flex items-center relative group">
          <NavLink
            to="/services"
            className={({ isActive }) => (isActive ? 'bg-[#a8e6cf]/10 text-[#a8e6cf] px-4 py-2 rounded-lg font-medium transition-all' : 'text-gray-200 px-4 py-2 rounded-lg font-medium hover:bg-[#a8e6cf]/10 hover:text-[#a8e6cf] transition-all')}
          >
            Service Directory
          </NavLink>
          <div className="absolute top-full left-0 bg-[#252525] min-w-[260px] rounded-xl shadow-xl shadow-black/40 border border-white/5 py-2 opacity-0 invisible transform -translate-y-2 transition-all duration-200 z-50">
            {loading ? (
              <div className="px-5 py-3 text-gray-400 text-sm">Loading...</div>
            ) : error ? (
              <div className="px-5 py-3 text-[#ff8a8a] text-sm">Error loading services</div>
            ) : (
              <ul className="max-h-[400px] overflow-y-auto custom-scrollbar">
                {services.map((svc) => (
                  <li key={svc.id}>
                    <Link to={`/services/${svc.id}`} className="block px-5 py-2.5 text-gray-300 text-sm hover:bg-[#a8e6cf]/10 hover:text-[#a8e6cf] transition-all whitespace-nowrap overflow-hidden text-ellipsis">
                      {svc.id}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
        <li className="h-full flex items-center">
          <NavLink
            to="/settings"
            className={({ isActive }) => (isActive ? 'bg-[#a8e6cf]/10 text-[#a8e6cf] px-4 py-2 rounded-lg font-medium transition-all' : 'text-gray-200 px-4 py-2 rounded-lg font-medium hover:bg-[#a8e6cf]/10 hover:text-[#a8e6cf] transition-all')}
          >
            Settings
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
