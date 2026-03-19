# Plan: Install and Configure Tailwind CSS in paas-ui

## Objective
Install and configure Tailwind CSS in the `paas-ui` service. This will standardise the styling approach for the frontend application using the modern Vite-integrated setup (Tailwind CSS v4).

## Key Files & Context
- `services/paas-ui/package.json`: Needs new devDependencies for Tailwind.
- `services/paas-ui/vite.config.ts`: Needs to register the `@tailwindcss/vite` plugin.
- `services/paas-ui/src/index.css`: Needs to include the Tailwind CSS directive and configure the default font family to use Inter (which is already present in `package.json`).

## Implementation Steps

1. **Install Dependencies**
   - Add `tailwindcss` and `@tailwindcss/vite` as development dependencies to the `paas-ui` workspace.
   - Run: `yarn workspace paas-ui add -D tailwindcss @tailwindcss/vite`

2. **Configure Vite Plugin**
   - Modify `services/paas-ui/vite.config.ts` to import and use the Tailwind CSS plugin.
   ```typescript
   import { defineConfig } from 'vite'
   import react from '@vitejs/plugin-react'
   import tailwindcss from '@tailwindcss/vite'

   export default defineConfig({
     plugins: [
       tailwindcss(),
       react()
     ],
   })
   ```

3. **Update Global CSS (`src/index.css`)**
   - Replace the existing manual reset (since Tailwind includes its own Preflight) with the Tailwind CSS import directive.
   - Configure the default sans font to use the Inter font, which is installed in the project.
   - Retain custom styling for scrollbars or specific components as needed.
   ```css
   @import "tailwindcss";

   @theme {
     --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";

   /* Retain any custom global overrides below (e.g., custom scrollbar) */
   ```

4. **Verify the Setup**
   - Update a test component (e.g., `services/paas-ui/src/App.tsx`) to include some Tailwind utility classes (e.g., `text-blue-500 font-bold`) to ensure styling is applied correctly.

## Verification & Testing
1. **Build Step:** Run `yarn workspace paas-ui build` to verify that Vite bundles the CSS properly without errors.
2. **Type Checking:** Ensure `tsc -b` completes successfully.
3. **Linting/Formatting:** Run `yarn format` to ensure the new Vite config complies with project standards.
