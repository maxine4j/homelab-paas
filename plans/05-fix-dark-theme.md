# Objective
Fix the light background issue on the Service Directory page by applying a dark mode theme with green highlights, consistent with the existing `TopNav` styling.

# Key Files & Context
- `services/paas-ui/index.html`: Base HTML file that needs global background and text color adjustments.
- `services/paas-ui/src/pages/service-directory-page.tsx`: Contains the table styling which is currently hardcoded to light mode colors (`bg-white`, `bg-gray-50`, `text-gray-900`, etc.).

# Implementation Steps

1. **Update Base Theme (index.html):**
   - Add Tailwind classes to the `<body>` element to establish a global dark theme: `bg-[#121212] text-gray-200`.

2. **Update Service Directory Page (service-directory-page.tsx):**
   - Refactor table container classes to dark mode and apply green highlights (`#a8e6cf`):
     - Change container and table borders: `divide-gray-200` to `divide-white/10`.
     - Change `<thead className="bg-gray-50">` to `bg-[#1e1e1e]`.
     - Change `<th>` text colors: `text-gray-500` to `text-gray-400`.
     - Change `<tbody className="bg-white divide-y divide-gray-200">` to `bg-[#1e1e1e] divide-y divide-white/10`.
     - Change table row hover effect: `hover:bg-gray-50` to `hover:bg-[#a8e6cf]/10 transition-colors`.
     - Change primary text color (Service Name) in `<td>`: `text-gray-900` to `text-gray-200`.
     - Change secondary text color (Owner ID, Replicas) in `<td>`: `text-gray-500` to `text-gray-400`.

# Verification & Testing
- Load the application via browser and navigate to the Service Directory page.
- Verify the page background is dark (`#121212`), and the table components match the TopNav's dark mode (`#1e1e1e`).
- Verify the table rows highlight with a faint green color (`#a8e6cf` with opacity) on hover.
- Confirm standard readability of the text (gray-200, gray-400).