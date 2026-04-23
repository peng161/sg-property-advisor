# SG Property Advisor — Design System

> **Rule:** Every time the UI is updated (including from a pasted design image), use the tokens and classes defined here. Do not pick new colors from the image — adapt the image's *layout and structure* but always apply this palette.

---

## Color Palette

| Token | Tailwind class | Hex | Role |
|---|---|---|---|
| `brand-bg` | `bg-brand-bg` | `#D9E4D7` | Page background — warm sage on every page |
| `brand-accent` | `bg-brand-accent` / `text-brand-accent` | `#FBBF24` | Primary accent — CTA buttons, selected states, highlights |
| `brand-accent-hover` | `bg-brand-accent-hover` | `#FCD34D` | Hover state for accent elements |
| `brand-dark` | `bg-brand-dark` / `text-brand-dark` | `#171717` | Dark surfaces — headers, stat cards, nav |
| `brand-dark-2` | `bg-brand-dark-2` | `#262626` | Hover state for dark elements |
| `brand-card` | `bg-brand-card` | `#FFFFFF` | Card / panel background |
| `brand-text` | `text-brand-text` | `#171717` | Headings and primary text |
| `brand-muted` | `text-brand-muted` | `#737373` | Secondary / descriptive text |
| `brand-subtle` | `text-brand-subtle` | `#A3A3A3` | Labels, placeholders, captions |
| `brand-border` | `border-brand-border` | `#E5E5E5` | Dividers and input borders |
| `brand-live` | `text-brand-live` | `#059669` | **Semantic only** — live data badge, positive values |
| `brand-live-bg` | `bg-brand-live-bg` | `#D1FAE5` | Background for live-data badge |
| `brand-error` | `text-brand-error` | `#EF4444` | Errors and negative values |

> Tokens are defined in `app/globals.css` under `@theme` and become Tailwind utility classes automatically.

---

## Tailwind Equivalents (quick reference)

When you need something not in the custom tokens above, use these exact Tailwind classes — do not invent new ones:

| Role | Class |
|---|---|
| Page background | `bg-brand-bg` |
| Card | `bg-white rounded-3xl shadow-sm` |
| Dark KPI card | `bg-brand-dark rounded-2xl` |
| Frosted glass header | `bg-white/75 backdrop-blur-md border-b border-white/50` |
| Primary button | `bg-brand-accent hover:bg-brand-accent-hover text-neutral-900 font-bold rounded-2xl` |
| Secondary button | `bg-neutral-900 hover:bg-neutral-800 text-white font-bold rounded-2xl` |
| Ghost button / pill | `bg-neutral-100 hover:bg-neutral-200 text-neutral-500 rounded-full` |
| Selected tile | `border-brand-accent bg-amber-50 border-2` |
| Unselected tile | `border-neutral-200 bg-white hover:border-neutral-300 border-2` |
| Input field | `bg-neutral-50 border border-neutral-200 rounded-2xl focus:ring-2 focus:ring-brand-accent` |
| Active filter pill | `bg-neutral-900 text-white border-neutral-900` |
| Inactive filter pill | `border-neutral-200 text-neutral-500 hover:border-neutral-300` |
| Recommended badge | `bg-brand-accent text-white font-bold` |
| Live data badge | `bg-brand-live-bg border-emerald-200 text-brand-live` |
| Error / out-of-range | `bg-red-50 text-brand-error` |

---

## Typography

| Role | Classes |
|---|---|
| Page / section title | `font-black text-neutral-900 tracking-tight` |
| Card heading | `font-bold text-neutral-900` |
| Section label (small caps) | `text-[10px] font-bold text-neutral-400 uppercase tracking-widest` |
| Body / description | `text-sm text-neutral-500` |
| Caption / note | `text-xs text-neutral-400` |
| Hero KPI number | `font-black text-white text-2xl leading-tight` (inside dark card) |

---

## Spacing & Shape

- **Page content max-width:** `max-w-3xl mx-auto px-4 sm:px-6`
- **Section gap:** `space-y-5`
- **Card radius:** `rounded-3xl` (panels), `rounded-2xl` (inner elements, inputs, buttons)
- **Pill radius:** `rounded-full` (filter chips, nav buttons)
- **Card shadow:** `shadow-sm` — no borders on cards

---

## What NOT to do

- ❌ Do not use `slate-*` colors — use `neutral-*` instead
- ❌ Do not use `emerald-*` for CTA buttons or selected states — that's the accent's job
- ❌ Do not use `emerald-*` for anything except live-data indicators and positive financial values
- ❌ Do not add borders to cards — use `shadow-sm` only
- ❌ Do not pick new colors from a pasted design image — adapt the layout, apply this palette
- ❌ Do not use `rounded-xl` on cards — use `rounded-3xl` / `rounded-2xl`

---

## Design Aesthetic

The UI is inspired by a modern property dashboard:
- Warm sage green page background makes white cards "float"
- Dark (`neutral-900`) stat cards create visual hierarchy for KPIs
- Amber gold accent is used sparingly — only for the most important interactive element on a screen
- Everything is rounded and soft — no sharp corners, no heavy borders
- Typography is clean: `font-black` for titles, `font-bold` for headings, regular weight for body
