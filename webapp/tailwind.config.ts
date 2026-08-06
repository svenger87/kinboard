import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	container: {
  		center: true,
  		padding: '2rem',
  		screens: {
  			'2xl': '1400px'
  		}
  	},
  	extend: {
  		// Two steps below text-xs. These exist because 76 hard-coded
  		// `text-[Npx]` utilities were scattered across 36 files: px is absolute,
  		// so the "larger text" accessibility setting (which scales the root
  		// font size) provably did not move a single one of them, and the app's
  		// smallest text stayed 9-11px however hard a user asked (audit KB-23).
  		// rem fixes that, and gives the kiosk density step in globals.css one
  		// place to raise the floor (KB-56).
  		fontSize: {
  			'3xs': ['0.6875rem', { lineHeight: '1rem' }],
  			'2xs': ['0.75rem', { lineHeight: '1.05rem' }],
  		},
  		colors: {
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			month: {
  				primary: 'hsl(var(--month-primary))',
  				secondary: 'hsl(var(--month-secondary))',
  				accent: 'hsl(var(--month-accent))'
  			},
  			success: {
  				DEFAULT: 'hsl(var(--success))',
  				foreground: 'hsl(var(--success-foreground))'
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--warning))',
  				foreground: 'hsl(var(--warning-foreground))'
  			},
  			info: {
  				DEFAULT: 'hsl(var(--info))',
  				foreground: 'hsl(var(--info-foreground))'
  			},
  			priority: {
  				low: 'hsl(var(--priority-low))',
  				medium: 'hsl(var(--priority-medium))',
  				high: 'hsl(var(--priority-high))'
  			},
  			weather: {
  				rain: 'hsl(var(--weather-rain))',
  				sun: 'hsl(var(--weather-sun))',
  				sunrise: 'hsl(var(--weather-sunrise))',
  				sunset: 'hsl(var(--weather-sunset))'
  			},
  			energy: {
  				solar: 'hsl(var(--energy-solar))',
  				battery: 'hsl(var(--energy-battery))',
  				grid: 'hsl(var(--energy-grid))',
  				consumption: 'hsl(var(--energy-consumption))'
  			},
  			person: {
  				coral: '#E2664E',
  				amber: '#D98A2B',
  				citron: '#8E9B36',
  				forest: '#3FA56B',
  				teal: '#2E9BA6',
  				sky: '#4A8FD6',
  				indigo: '#6E72C9',
  				lilac: '#A968C4',
  				berry: '#D667A0',
  				clay: '#B07B53'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		boxShadow: {
  			'elev-sm': '0 1px 2px rgba(40,50,30,.05), 0 1px 3px rgba(40,50,30,.07)',
  			'elev-md': '0 2px 8px rgba(40,50,30,.06), 0 10px 28px rgba(40,50,30,.06)',
  			'elev-lg': '0 6px 16px rgba(40,50,30,.09), 0 20px 50px rgba(40,50,30,.09)'
  		},
  		fontFamily: {
  			sans: [
  				'var(--font-sans)',
  				'system-ui',
  				'sans-serif'
  			],
  			mono: [
  				'var(--font-mono)',
  				'monospace'
  			],
  			display: [
  				'var(--font-display)',
  				'system-ui',
  				'sans-serif'
  			]
  		},
  		keyframes: {
  			'accordion-down': {
  				from: { height: '0' },
  				to: { height: 'var(--radix-accordion-content-height)' }
  			},
  			'accordion-up': {
  				from: { height: 'var(--radix-accordion-content-height)' },
  				to: { height: '0' }
  			},
  			'fade-in': {
  				from: { opacity: '0' },
  				to: { opacity: '1' }
  			},
  			'fade-up': {
  				from: { opacity: '0', transform: 'translateY(10px)' },
  				to: { opacity: '1', transform: 'translateY(0)' }
  			},
  			'scale-in': {
  				from: { opacity: '0', transform: 'scale(0.95)' },
  				to: { opacity: '1', transform: 'scale(1)' }
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out',
  			'fade-in': 'fade-in 0.5s ease-out',
  			'fade-up': 'fade-up 0.5s ease-out',
  			'scale-in': 'scale-in 0.3s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};

export default config;
