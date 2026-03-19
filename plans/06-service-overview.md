## Plan Overview

The service overview page will be a comprehensive dashboard-style page with:

1. **Side Navigation** - A fixed sidebar with sections for Overview, API Spec, Documentation, Dependencies, and Deployments
2. **Breadcrumbs** - Top-level navigation showing "Services / [service-id]"
3. **Service Header** - Prominent display of the service ID
4. **Key Details** - Health status and owner ID shown as cards/sections

## Architecture & Components

### File Structure
- **Service Overview Page**: `services/paas-ui/src/pages/service-overview-page.tsx` (update existing)
- **Service Detail Hook**: `services/paas-ui/src/hooks/use-service-detail.ts` (new file)
- **Service Detail Interface**: Update in `fetch-services.ts` to include detailed service info

### Key Features

#### 1. **ServiceDetail Interface**
Expand the existing ServiceMock interface to include:
- `id`: Service identifier (already exists)
- `status`: 'healthy' | 'unhealthy' (already exists)
- `ownerId`: Owner identifier (already exists)
- `image`: Docker image name
- `replicas`: Number of running replicas
- `port`: Ingress port
- `serviceProxy`: Service proxy aliases
- `hostPorts`: Host port mappings
- `environment`: Environment variables
- `volumes`: Volume mounts

#### 2. **Side Navigation Component**
Create a reusable `<ServiceSidebar>` component with:
- Fixed position on desktop, collapsible on mobile
- Navigation links with active state highlighting
- Sections: Overview, API Spec, Documentation, Dependencies, Deployments
- Hover effects matching the existing dark theme

#### 3. **Breadcrumb Component**
Create a `<Breadcrumbs>` component with:
- "Services" link
- Current service ID (non-clickable)
- Chevron separator
- Consistent styling with existing theme

#### 4. **ServiceHeader Component**
Create a `<ServiceHeader>` component featuring:
- Large service ID title
- Health status indicator (green/red circle)
- Owner ID display
- Optional action buttons (Edit, Delete, Restart)

#### 5. **Detail Cards**
Create `<DetailCard>` component for displaying key information:
- Health Status card
- Owner ID card
- Image/Container info card
- Replicas/Port information card

## Implementation Steps

### Phase 1: Data Layer
1. **Update ServiceMock Interface** - Add detailed fields to fetch-services.ts
2. **Create useServiceDetail Hook** - Fetch and manage single service data with loading/error states
3. **Update mock data** - Add detailed service information

### Phase 2: UI Components
4. **Create Breadcrumbs Component** - Navigation breadcrumbs
5. **Create ServiceSidebar Component** - Fixed side navigation with sections
6. **Create ServiceHeader Component** - Service title and key info display
7. **Create DetailCard Component** - Reusable card for displaying service details

### Phase 3: Main Page Integration
8. **Update service-overview-page.tsx** - Combine all components:
   - Layout with sidebar and main content area
   - Breadcrumbs at top
   - ServiceHeader section
   - Detail cards for health status and owner ID
   - Placeholder sections for other navigation items (API Spec, Documentation, Dependencies, Deployments)

### Phase 4: Styling
9. **Apply existing dark theme** - Use consistent colors from existing components
   - Background: `#121212`, `#1e1e1e`
   - Accent: `#a8e6cf`
   - Text: `#e5e5e5`, `#9ca3af`
   - Borders: `white/10`

## Technical Considerations

- **React Router Integration**: Use `useParams` to get service ID from URL
- **Responsive Design**: Sidebar should be collapsible on mobile, fixed on desktop
- **Type Safety**: Maintain TypeScript interfaces for all components
- **Loading States**: Handle loading states for the service detail hook
- **Error Handling**: Display error states gracefully

## Design Pattern

Following the existing project patterns:
- Dark theme styling
- Tailwind CSS for styling
- Custom hook pattern for data fetching
- Component-based architecture
- Consistent naming conventions
