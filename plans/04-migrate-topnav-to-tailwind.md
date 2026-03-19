# Migration Plan: TopNav to Tailwind CSS

## Objective
Migrate the navigation bar component from custom CSS to Tailwind CSS utility classes.

## Current State Analysis

### Files Involved
- **TopNav.tsx**: Uses custom CSS classes (`.top-nav`, `.top-nav-brand`, `.top-nav-links`, `.dropdown-container`, etc.)
- **TopNav.css**: Contains 100% custom CSS styling (~150 lines)
- **index.css**: Has Tailwind CSS imported and some custom scrollbar styles
- **page.css**: Minimal custom styles (`.page-container`)
- **vite.config.ts**: Tailwind CSS plugin is properly configured

### Custom CSS Breakdown
- `.top-nav`: Layout container with flexbox, spacing, colors, shadows, border-radius, positioning
- `.top-nav-brand`: Logo/link styling with hover effects
- `.top-nav-links`: Navigation links layout and styling
- `.dropdown-container`, `.dropdown-menu`, `.dropdown-list`: Dropdown menu functionality
- Custom scrollbar styling for dropdown list

## Migration Strategy

### Step 1: Migrate TopNav.tsx to Tailwind Classes
Replace all custom CSS class names with Tailwind utility classes while maintaining the same visual appearance.

### Step 2: Remove Custom CSS Import
Remove `import './TopNav.css';` from TopNav.tsx

### Step 3: Delete TopNav.css File
Remove `services/paas-ui/src/components/navigation/TopNav.css` entirely

### Step 4: Update index.css (Optional)
Preserve custom scrollbar styles if needed

## Design Decisions

### Color Palette (from existing CSS)
- Background: `bg-[#1e1e1e]` (dark theme)
- Primary text: `text-white`
- Secondary text: `text-gray-200`, `text-gray-300`
- Accent color: Custom theme variable `#a8e6cf` (will use arbitrary values)
- Dropdown background: `bg-[#252525]`
- Error color: `text-[#ff8a8a]`

### Spacing & Layout
- Container padding: `p-6` (24px)
- Nav height: `h-16` (64px)
- Brand font size: `text-xl` or `text-2xl`
- Link padding: `px-4 py-2` (16px x 8px)
- Dropdown min-width: `w-[260px]`

### Tailwind Features to Use
- Flexbox utilities for layout (`flex`, `items-center`, `justify-between`)
- Spacing utilities for margins/padding (`p-6`, `m-6`, `gap-2`, etc.)
- Color utilities with arbitrary values (`bg-[#1e1e1e]`, `text-[#a8e6cf]`)
- Transitions and hover states (`transition-all`, `duration-200`, `hover:bg-opacity-10`)
- Relative/absolute positioning for dropdown
- Custom scrollbar styling via Tailwind's `scrollbar-*` or custom CSS

## Expected Outcome
- Navigation bar will use 100% Tailwind utility classes
- TopNav.css file will be deleted
- Component will maintain the same visual appearance and functionality
- Consistent with the rest of the project (Tailwind is configured and used)

## Verification
- Run `yarn build` in paas-ui to ensure no build errors
- Verify the navigation bar renders correctly with Tailwind classes
- Check that all interactions (hover, dropdown, active states) work as expected