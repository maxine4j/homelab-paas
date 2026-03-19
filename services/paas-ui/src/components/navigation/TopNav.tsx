import { NavLink, Link } from 'react-router-dom';
import { useFetchServices } from '../../hooks/fetch-services';
import './TopNav.css';

export function TopNav() {
  const { services, loading, error } = useFetchServices();

  return (
    <nav className="top-nav">
      <div className="top-nav-brand">
        <Link to="/">PaaS UI</Link>
      </div>
      <ul className="top-nav-links">
        <li>
          <NavLink
            to="/"
            className={({ isActive }) => (isActive ? 'active-link' : '')}
            end
          >
            Dashboard
          </NavLink>
        </li>
        <li className="dropdown-container">
          <NavLink
            to="/services"
            className={({ isActive }) => (isActive ? 'active-link' : '')}
          >
            Service Directory
          </NavLink>
          <div className="dropdown-menu">
            {loading ? (
              <div className="dropdown-loading">Loading...</div>
            ) : error ? (
              <div className="dropdown-error">Error loading services</div>
            ) : (
              <ul className="dropdown-list">
                {services.map((svc) => (
                  <li key={svc.id}>
                    <Link to={`/services/${svc.id}`}>{svc.name}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
        <li>
          <NavLink
            to="/settings"
            className={({ isActive }) => (isActive ? 'active-link' : '')}
          >
            Settings
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
