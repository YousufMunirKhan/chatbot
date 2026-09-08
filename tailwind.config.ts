import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/modules/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    // Tailwind's five defaults, restated so `xs` can be inserted IN ORDER.
    // `theme.extend.screens` appends instead of sorting, which would emit the
    // `xs:` media query after `2xl:` and let `xs:` quietly beat `sm:`/`md:` at
    // every width above 400px. Defining the whole list is the only way to add a
    // breakpoint below `sm` without that.
    //
    // READ THIS BEFORE USING IT: `xs:` asks about the VIEWPORT, exactly like
    // `sm:`/`md:`/`lg:`. It is the right tool for a page shell and the wrong tool
    // inside a card that can sit in a 360px column. For that, use `FieldGrid`
    // (src/components/ui/field-grid.tsx), which measures the container.
    screens: {
      xs: '400px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        // Brand (Module 22). `DEFAULT` used to be a fourth, unrelated hex
        // (#1d4ed8) with zero usages; it now tracks `--primary`, the one blue.
        // `sidebar` is left as a literal because the visible sidebar is painted
        // by the `.bg-brand-sidebar` gradient utility in globals.css, and this
        // entry only backstops it.
        brand: {
          DEFAULT: 'hsl(var(--primary))',
          // Backstop behind the `.bg-brand-sidebar` gradient, and the ring
          // offset for focus rings on it. Was the literal `#13224b`, which in
          // dark mode sat a full stop lighter than the ramp it backs; now it
          // tracks `--sidebar-base`, defined in both themes.
          sidebar: 'hsl(var(--sidebar-base))',
          // The white plate under the logo PNG — white in both themes on
          // purpose (Module 23; see globals.css).
          plate: 'hsl(var(--brand-plate))',
        },
        // Sidebar chrome (Module 23). The gradient is a fixed dark surface in
        // either theme, so these are near-white in either theme; they exist so
        // the nav stops reaching into the raw blue palette for its text.
        sidebar: {
          fg: 'hsl(var(--sidebar-fg))',
          'fg-muted': 'hsl(var(--sidebar-fg-muted))',
          'fg-subtle': 'hsl(var(--sidebar-fg-subtle))',
          // Alpha is baked into these two so one value works over all four
          // stops of the ramp; they take no Tailwind opacity modifier.
          active: 'var(--sidebar-item-active-bg)',
          hover: 'var(--sidebar-item-hover-bg)',
        },
        // Impersonation banner (Module 23). Fuchsia is used by nothing else in
        // the product, which is the entire point of it — see globals.css.
        impersonation: {
          DEFAULT: 'hsl(var(--impersonation))',
          border: 'hsl(var(--impersonation-border))',
          critical: 'hsl(var(--impersonation-critical) / <alpha-value>)',
          fg: 'hsl(var(--impersonation-fg))',
          'fg-muted': 'hsl(var(--impersonation-fg-muted))',
          accent: 'hsl(var(--impersonation-accent))',
          'alarm-bg': 'hsl(var(--impersonation-alarm-bg))',
          'alarm-fg': 'hsl(var(--impersonation-alarm-fg))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Semantic state triplets (Module 22). `bg-success-bg` /
        // `border-success-border` / `text-success-fg` is the tinted-surface
        // set; bare `bg-success` is the solid mark. See globals.css.
        success: {
          DEFAULT: 'hsl(var(--success))',
          bg: 'hsl(var(--success-bg))',
          border: 'hsl(var(--success-border))',
          fg: 'hsl(var(--success-fg))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          bg: 'hsl(var(--warning-bg))',
          border: 'hsl(var(--warning-border))',
          fg: 'hsl(var(--warning-fg))',
        },
        danger: {
          DEFAULT: 'hsl(var(--danger))',
          bg: 'hsl(var(--danger-bg))',
          border: 'hsl(var(--danger-border))',
          fg: 'hsl(var(--danger-fg))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          bg: 'hsl(var(--info-bg))',
          border: 'hsl(var(--info-border))',
          fg: 'hsl(var(--info-fg))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      // `aria-invalid` is NOT one of Tailwind's nine built-in `aria-*` variants
      // (busy, checked, disabled, expanded, hidden, pressed, readonly, required,
      // selected), so `aria-invalid:border-danger` silently produced no CSS.
      // `FormField` injects `aria-invalid` on the control it wraps, which means
      // every text control in the product announced its error to a screen reader
      // and showed nothing to anyone looking at it. Registering it here is what
      // lets `Input`/`Textarea`/`Select` carry the visible error state.
      aria: {
        invalid: 'invalid="true"',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
