# Objective
Update the `paas-ui` frontend to use a fully dark theme with green highlights and change the default font to a sans-serif font.

# Key Files & Context
- `services/paas-ui/src/index.css`: To be populated with global dark theme CSS (background, text color, font family, link styling).
- `services/paas-ui/src/components/page.css`: Currently defines `.page-container` with a specific dark background that conflicts with a fully unified dark theme. It needs updating to inherit or blend with the global dark theme.

# Implementation Steps
1. **Update Global CSS (`services/paas-ui/src/index.css`)**:
   - Apply a global reset for `margin` and `padding` on `body` and `html`, or ensure they cover the full screen (`height: 100vh;`, `width: 100vw;`).
   - Set the `font-family` on `body` to a standard sans-serif stack (e.g., `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`).
   - Set the global `background-color` to a dark shade (e.g., `#121212`).
   - Set the global text `color` to a light shade (e.g., `#e0e0e0`).
   - Style headings (`h1`, `h2`, `h3`) to use a solid white color (e.g., `#ffffff`).
   - Style anchor tags (`a`), selections (`::selection`), and focus rings to use the green highlight color (`#a8e6cf` to match the TopNav).

2. **Update Page Component CSS (`services/paas-ui/src/components/page.css`)**:
   - Change the hardcoded `background-color: rgb(38, 36, 40);` in `.page-container` to `transparent` so the global dark background is visible everywhere.
   - Add appropriate padding to `.page-container` to align with the TopNav (e.g., `padding: 0 32px;`).
   - Ensure the `h1` inside `.page-container` does not have unstyled default margins that break the layout.

# Verification & Testing
- Open the application in the browser after starting the dev server.
- Verify that the entire page background is dark and fills the viewport.
- Verify that the text font is sans-serif.
- Verify that the "Homelab Dashboard" heading is visible and properly formatted.
- Ensure the overall aesthetic looks cohesive with the black/green TopNav.