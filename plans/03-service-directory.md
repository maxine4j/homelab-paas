# Services Directory Page Plan

## Objective
Update the `ServiceDirectoryPage` to list services in a data table showing relevant details such as service name, health indicator (green/red), replica count, and owner ID.

## Scope & Impact
- Modify `services/paas-ui/src/hooks/fetch-services.ts` to include more data fields in the mock services.
- Update `services/paas-ui/src/pages/service-directory-page.tsx` to render the data in a structured table.

## Key Files & Context
- `services/paas-ui/src/hooks/fetch-services.ts`: The current service mock needs `replicas` (number), `ownerId` (string), and `status` (string/enum indicating health).
- `services/paas-ui/src/pages/service-directory-page.tsx`: The actual page component. It currently renders a blank page container.

## Proposed Solution

### 1. Update Mock Data
Update `ServiceMock` interface in `fetch-services.ts` to include:
- `status`: 'healthy' | 'unhealthy'
- `replicas`: number
- `ownerId`: string

Populate the existing `mockServices` array with varied values for these fields.

### 2. Implement Table UI
In `service-directory-page.tsx`, import `useFetchServices` and fetch the data.
Render a table containing the following columns in order (optimized for scannability and UX):

1. **Status**: A green circle icon (e.g., using `CheckCircle2` or a simple green dot) for healthy, and a red cross or dot for unhealthy.
2. **Name**: The service ID/Name.
3. **Owner ID**: The owner identifier.
4. **Replicas**: The number of running replicas.

Add loading states (e.g., a simple "Loading services..." or spinner) and error states ("Failed to load services").

### 3. Styling
Use standard HTML `<table>` elements styled with plain css to ensure the table is visually appealing with appropriate padding, border styling, and hover states. Create our own custom icon components, with inlined svgs. For this project we should just need a circle.

## Implementation Steps
1. **Edit `services/paas-ui/src/hooks/fetch-services.ts`**:
   - Update `ServiceMock` type to `{ id: string, status: 'healthy' | 'unhealthy', replicas: number, ownerId: string }`.
   - Update `mockServices` elements to include the new fields, make up some names and replica counts. Make about 4 services unhealthy.
2. **Edit `services/paas-ui/src/components/icons/circle.tsx`**:
   - Export a `<CircleIcon color={'red'} />` component that returns an svg of a circle
2. **Edit `services/paas-ui/src/pages/service-directory-page.tsx`**:
   - Use the hook `const { services, loading, error } = useFetchServices();`.
   - Handle `loading` and `error` states gracefully.
   - Build a `<table>` iterating over `services`. Render the agreed-upon columns.
   - Add Tailwind classes for standard table styles (e.g. `min-w-full divide-y divide-gray-200`).
   - Import and use `CircleIcon` for the green/red indicator.

## Verification
- Visit the Services directory page in the dev server.
- The table must render gracefully with all mock services.
- Sorting/ordering is handled by the hook which already sorts alphabetically.
- Green and red indicators correctly display based on the `status` mock value.
- Loading and error states are tested by manipulating the hook's network delay/error mechanisms.
