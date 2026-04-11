# RetailOS — Cursor AI Project Context

> Paste this file into every new Cursor chat session before giving instructions.
> It gives Cursor the full picture: what we're building, the data model,
> the business logic, and the exact design system to follow.

### DESIGN LOCK (include in every prompt)

Do not change any style, `className`, or inline style value that already exists in a working component. Only add styles for new elements being introduced. If unsure whether a style change is needed, do not make it.

---

## 1. What This App Is

**RetailOS** is a retail inventory intelligence tool for a sportswear business.
It reads product data from CSV files and gives the team full visibility
on what is selling, what is not, and what actions to take — automatically.

**Company:** Driloni Sportswear (internal tool)
**Industry:** Sportswear retail (Diadora, Fila, Grisport, adidas, nike, new balance brands)
**Users:** Store managers and buying team

---

## 2. Core CSV Data Fields

Every product enters the system via a CSV file with these exact columns:

| Field | Type | Notes |
|-------|------|-------|
| `barcode` | string | Unique product barcode |
| `sku` | string | Internal SKU code e.g. `FIL-TRN-BRA-F-M` |
| `product_name` | string | Human-readable name |
| `size` | string | e.g. `42`, `M`, `XL`, `28` |
| `price_sold` | number | Selling price in EUR |
| `quantity` | number | Total units imported |
| `sold_quantity` | number | Units sold so far (updated manually or via POS) |
| `import_date` | date | Date stock arrived in store — **drives lifecycle status** |
| `gender` | string | `M` = Male, `F` = Female, `K` = Kids |
| `season` | string | `SS26` or `FW26` |
| `category` | string | `Footwear`, `Apparel`, `Accessories` |
| `brand` | string | `Diadora`, `Fila`, `Grisport`, `adidas`, `nike`, `new balance` |

---

## 3. SKU Lifecycle Logic — Rule-Based, Never Manual

Status is calculated automatically from `import_date` and sell-through %.
**The user never manually sets a status.**

```
days_in_store = today - import_date
sell_through  = sold_quantity / quantity * 100
```

### Status Rules (apply in order):

| Status | Condition | Color |
|--------|-----------|-------|
| **New Arrival** | days_in_store <= 30 | `#38bdf8` (blue) |
| **Active** | days_in_store 31–90 | `#00e676` (green) |
| **Aging** | days_in_store 91–150 AND sell_through >= 20% | `#fbbf24` (yellow) |
| **Risk** | days_in_store 91–150 AND sell_through < 20% | `#ff8800` (orange) |
| **Clearance** | days_in_store 151–180 | `#ff3333` (red) |
| **Outlet** | days_in_store > 180 | `#c084fc` (purple) |

### Stock Modifier Rules:
- If sell_through >= 60% at any stage → show 🔥 and flag for **reorder**
- If sell_through < 10% AND days_in_store > 120 → escalate urgency, show ⚠

---

## 4. Bestseller Logic

Rank all SKUs by **% sell-through in the last 30 days** — NOT raw quantity sold.
This ensures a 3-unit apparel item and a 40-pair shoe are ranked fairly.

```
bestseller_score = sold_in_last_30_days / quantity * 100
```

- Score >= 40% → show 🔥 badge, card moves to top of grid
- Score >= 60% → trigger reorder alert on Dashboard
- Score < 10% in last 30 days → flag as slow mover

---

## 5. Pages & Navigation Structure

```
OVERVIEW
  ├── Dashboard          — KPIs, alerts, sell-through chart, gender split
  ├── SKU Lifecycle      — 6-lane kanban board
  ├── Bestsellers        — Product cards ranked by sell-through %
  └── Rotation Strategy  — Rule-based action recommendations

DATA
  ├── Reports            — Exportable reports (season, markdown, age, reorder)
  ├── Import CSV         — Drag-and-drop CSV upload with preview
  └── Product Photos     — Upload/manage photos, auto-matched by SKU filename

CATALOG
  ├── Footwear           — 142 SKUs, brand breakdown, size coverage grid
  ├── Apparel            — 86 SKUs, category split (tops/bottoms/outerwear)
  └── Accessories        — 34 SKUs, caps/bags/socks
```

---

## 6. Smart Alerts — Dashboard Logic

Generate alerts automatically every time the app loads:

| Alert type | Trigger | Urgency |
|-----------|---------|---------|
| 🔴 Clearance tomorrow | days_in_store = 148–150 | Do today |
| 🟠 Aging + low sell-through | days_in_store > 90 AND sell_through < 25% | This week |
| 🟠 Transition warning | days_in_store = 28–30 (leaving New Arrival) | Info |
| 🟢 Bestseller / reorder | sell_through > 60% in 21 days | Opportunity |
| 🔵 Status change | Any SKU crossing a day threshold today | Info |

---

## 7. Rotation Strategy Recommendations

Auto-generate action cards based on lifecycle status:

| Situation | Recommended Action |
|-----------|-------------------|
| SKU entering Clearance in 7 days | Apply -30% markdown |
| SKU Aging + sell_through < 20% | Move to window display / front of store |
| SKU Active + sell_through > 60% | Trigger reorder |
| Two Aging SKUs in same category | Suggest bundle deal at -15% |
| Outlet SKU > 200 days | Final price push or lot sale |

---

## 8. Tech Stack

```
Frontend:    React 18 + Vite
Styling:     Tailwind CSS
State:       Zustand
CSV Parser:  PapaParse
Charts:      Recharts
Router:      React Router v6
Database:    better-sqlite3 (local SQLite)
Photos:      /public/photos/{SKU}.jpg convention
```

---

## 9. Folder Structure

```
retailos/
├── public/
│   └── photos/               ← product images named by SKU e.g. FIL-TRN-BRA-F-M.jpg
├── src/
│   ├── components/
│   │   ├── Sidebar.jsx
│   │   ├── Topbar.jsx
│   │   ├── KpiCard.jsx
│   │   ├── SkuTile.jsx
│   │   ├── ProductCard.jsx
│   │   ├── AlertItem.jsx
│   │   ├── StrategyItem.jsx
│   │   └── ProgressBar.jsx
│   ├── pages/
│   │   ├── Dashboard.jsx
│   │   ├── Lifecycle.jsx
│   │   ├── Bestsellers.jsx
│   │   ├── Strategy.jsx
│   │   ├── Reports.jsx
│   │   ├── ImportCSV.jsx
│   │   ├── Photos.jsx
│   │   ├── Footwear.jsx
│   │   ├── Apparel.jsx
│   │   └── Accessories.jsx
│   ├── store/
│   │   └── useStore.js        ← Zustand global state
│   ├── utils/
│   │   ├── lifecycle.js       ← getLifecycleStatus(), getSellThrough()
│   │   ├── bestsellers.js     ← rankBySellThrough(), getAlerts()
│   │   └── csvParser.js       ← parseCSV() using PapaParse
│   ├── data/
│   │   └── db.js              ← SQLite connection via better-sqlite3
│   ├── App.jsx
│   └── main.jsx
├── CURSOR_CONTEXT.md          ← this file
└── package.json
```

---

## 10. Design System — Match the HTML Prototype Exactly

### Color Palette (CSS variables → Tailwind custom colors)

```js
// tailwind.config.js
colors: {
  bg:       '#09090e',
  surface:  '#111117',
  surface2: '#17171f',
  surface3: '#1e1e28',
  text:     '#e4e4f0',
  text2:    '#9090aa',
  muted:    '#4a4a62',
  accent:   '#ff3333',   // primary red — buttons, active nav, alerts
  accent2:  '#ff8800',   // orange — risk, warnings
  green:    '#00e676',   // active status, success, bestseller
  blue:     '#38bdf8',   // new arrival, info
  purple:   '#c084fc',   // outlet status, apparel
  yellow:   '#fbbf24',   // aging status, warnings
  pink:     '#f472b6',   // female, gender indicators
  teal:     '#2dd4bf',   // accessories, teal accents
}
```

### Typography

```
Headings / Labels:  'Bebas Neue' — font-size varies, letter-spacing: 2–3px
Body / UI text:     'DM Sans' — weights 300, 400, 500, 600, 700
Monospace / Data:   'JetBrains Mono' — SKU codes, numbers, dates
```

Import in index.html:
```html
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

### Layout

```
Sidebar width:    228px, fixed left, full height
Topbar height:    58px, sticky top, backdrop-blur
Content padding:  24px 28px
Border radius:    cards = 12–13px, buttons = 8px, badges = 20px
Scrollbar:        3px wide, #2a2a38 thumb, transparent track
```

### Component Specs

**KPI Card**
```
background: surface (#111117)
border: 1px solid rgba(255,255,255,0.055)
border-radius: 11px
top accent bar: 2px, color = lifecycle status color
padding: 14px 16px
label: 9px, muted, uppercase, letter-spacing 1.5px
value: Bebas Neue, 30px, white
sub: 10px, muted
tag pill: 9px, bold, uppercase, colored bg at 10% opacity
hover: translateY(-2px), border brightens
```

**Sidebar Nav Item**
```
padding: 8px 10px
border-radius: 9px
default color: #9090aa (text2)
hover: background surface2, color white
active: background rgba(255,51,51,0.1), color white
active left border: 2px solid #ff3333, positioned top 20% to bottom 20%
icon box: 28x28px, border-radius 7px, background surface2
active icon box: background rgba(255,51,51,0.15)
badge: 9px bold, colored bg pill
```

**SKU Tile (Kanban Card)**
```
background: surface2
border: 1px solid rgba(255,255,255,0.055)
border-radius: 8px
left accent strip: 2px, color = lifecycle status color
padding: 9px 10px
name: 11px, font-weight 600
sku code: JetBrains Mono, 9px, muted
days: JetBrains Mono, 9px, muted
sell-through %: 9px, bold, color = lifecycle status color
progress bar: 3px height, colored fill
hover: translateX(2px), border brightens
```

**Product Card (Bestsellers)**
```
background: surface
border: 1px solid rgba(255,255,255,0.055)
border-radius: 13px
thumbnail area: 140px height, gradient background, emoji placeholder
rank badge: top-left, dark glass bg, Bebas Neue
fire badge: top-right, emoji
sell-through value: Bebas Neue 22px, green (or status color)
hover: translateY(-4px), shadow 0 18px 40px rgba(0,0,0,0.4)
```

**Alert Item**
```
display: flex, gap 10px
padding: 10px 12px
border-radius: 9px
border: 1px solid colored at 18% opacity
background: colored at 5% opacity
red variant:    rgba(255,51,51,...)
orange variant: rgba(255,136,0,...)
blue variant:   rgba(56,189,248,...)
green variant:  rgba(0,230,118,...)
hover: translateX(3px)
```

**Strategy Action Item**
```
background: surface2
border: 1px solid rgba(255,255,255,0.055)
border-radius: 9px
padding: 10px 12px
icon: 18px emoji, flex-shrink 0
urgency badge: 9px bold uppercase pill
  🔴 Do today:   rgba(255,51,51,0.1)  color accent
  🟠 This week:  rgba(255,136,0,0.1)  color accent2
  🟢 Opportunity: rgba(0,230,118,0.1) color green
  🔵 Consider:   rgba(56,189,248,0.1) color blue
hover: border brightens
```

**Buttons**
```
btn-ghost:  bg surface2, border rgba(255,255,255,0.055), color text2
btn-red:    bg #ff3333, color white — hover #ff5252
btn-green:  bg rgba(0,230,118,0.12), color green, border rgba(0,230,118,0.2)
all:        padding 7px 13px, border-radius 8px, font-size 12px, font-weight 600
```

**Status Chips (inline)**
```
display: inline-flex, align-items center, gap 4px
padding: 3px 8px, border-radius 6px
font: 10px bold uppercase letter-spacing 0.8px
dot: 5x5px circle, same color as text
colors follow lifecycle status palette
```

**Progress Bar**
```
wrapper: height 3px, background rgba(255,255,255,0.05), border-radius 2px
fill: same height, border-radius 2px, color = lifecycle status
transition: width 1.1s ease (animate on mount)
```

**Topbar**
```
height: 58px, sticky, z-index 100
background: rgba(9,9,14,0.88) with backdrop-filter blur(24px)
border-bottom: 1px solid rgba(255,255,255,0.055)
padding: 0 28px
title: Bebas Neue 19px, letter-spacing 2px
breadcrumb: 11px muted
right: search box + season pills + export btn + import btn
```

**Tables**
```
wrapper: surface bg, border, border-radius 13px, overflow hidden
th: 9px, bold, uppercase, letter-spacing 1.5px, muted color, padding 9px 14px
td: 12px, padding 9px 14px
row hover: background surface2
border-bottom between rows: 1px solid rgba(255,255,255,0.055)
monospace cells: JetBrains Mono 11px
```

**Category Cards**
```
background: surface
border-radius: 13px
hero area: 110px, gradient bg + emoji
body padding: 13px
name: Bebas Neue 17px, letter-spacing 1.5px
sell-through bar: 4px height, colored
hover: translateY(-3px), shadow
```

**Upload Zone**
```
border: 2px dashed rgba(255,255,255,0.055)
border-radius: 12px
padding: 28px 20px
text-align: center
hover: border-color #ff3333, background rgba(255,51,51,0.03)
```

### Animations

```css
/* Page load — staggered reveal */
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* Apply with delays: d1=0.04s, d2=0.09s, d3=0.14s, d4=0.19s */

/* Live indicator dot */
@keyframes blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.2; }
}
/* Apply to 6x6px circles on section titles */

/* Progress bars — animate width on mount */
/* Start at width: 0, transition to target width: 1.1s ease */
```

### Kanban Board Grid

```
display: grid
grid-template-columns: repeat(6, 1fr)
gap: 8px
lane min-height: 340px
lane background: surface
lane border-radius: 12px
lane padding: 12px
```

### Season Card (Sidebar Footer)

```
background: surface2
border: 1px solid rgba(255,255,255,0.055)
border-radius: 11px
padding: 12px 14px
label: 9px muted uppercase
value: Bebas Neue 22px, color accent2 (#ff8800)
icon: 22px emoji
```

---

## 11. Sample Cursor Prompts (Use These in Order)

### Prompt 1 — Tailwind Config
```
Set up tailwind.config.js with custom colors and fonts
from Section 10 of CURSOR_CONTEXT.md.
Add Bebas Neue, DM Sans, JetBrains Mono as font families.
```

### Prompt 2 — Zustand Store
```
Create src/store/useStore.js using Zustand.
Store: array of SKUs with all fields from Section 2 of CURSOR_CONTEXT.md.
Actions: setSkus, addSkus, clearSkus, updateSku.
Also store: activeSeason (default 'SS26'), activeFilter (default 'all').
```

### Prompt 3 — Lifecycle Utility
```
Create src/utils/lifecycle.js.
Export getLifecycleStatus(importDate, soldQty, totalQty) using the
exact rules from Section 3 of CURSOR_CONTEXT.md.
Export getSellThrough(soldQty, totalQty) returning a number 0–100.
Export STATUS_COLORS object mapping each status to its hex color.
Export getDaysInStore(importDate) returning number of days since import.
```

### Prompt 4 — CSV Parser
```
Create src/utils/csvParser.js using PapaParse.
Export parseCSV(file) accepting a File object.
Map the column names from Section 2 of CURSOR_CONTEXT.md.
Parse import_date as a JavaScript Date object.
Return array of clean SKU objects ready for Zustand store.
```

### Prompt 5 — Alerts Generator
```
Create src/utils/alerts.js.
Export generateAlerts(skus) which loops all SKUs and returns
an array of alert objects using the logic from Section 4 of CURSOR_CONTEXT.md.
Each alert: { type, urgency, skuCode, productName, message, action }
urgency values: 'critical', 'warning', 'info', 'opportunity'
```

### Prompt 6 — Sidebar Component
```
Create src/components/Sidebar.jsx matching the exact design
from Section 10 of CURSOR_CONTEXT.md (Sidebar Nav Item spec).
Three nav groups: Overview, Data, Catalog with the pages from Section 5.
Use React Router NavLink for active state detection.
Include the Season Card at the bottom showing activeSeason from Zustand.
Import fonts from Google Fonts as specified.
```

### Prompt 7 — Dashboard Page
```
Create src/pages/Dashboard.jsx.
Use the KPI Card spec from Section 10 of CURSOR_CONTEXT.md.
Show 6 KPI cards (one per lifecycle status) with live counts from Zustand.
Use generateAlerts() to show the smart alerts panel.
Show a sell-through bar chart using Recharts (last 8 weeks).
Show a gender split donut using Recharts PieChart.
Apply fadeUp animation with staggered delays on mount.
```

### Prompt 8 — Lifecycle Kanban
```
Create src/pages/Lifecycle.jsx.
6-column kanban grid using the exact specs from Section 10 of CURSOR_CONTEXT.md.
Each column = one lifecycle status with lane header + count badge.
Each SKU rendered as a SkuTile component.
Filter pills above for: All, Footwear, Apparel, Male, Female, Kids.
Get statuses from getLifecycleStatus() utility — never hardcode.
```

### Prompt 9 — Bestsellers Page
```
Create src/pages/Bestsellers.jsx.
Rank all SKUs using bestseller_score from Section 4 of CURSOR_CONTEXT.md.
Render as ProductCard grid (5 columns).
If /public/photos/{sku}.jpg exists, show it as thumbnail. Otherwise show emoji.
Add 🔥 badge if score > 40%.
Below the grid, show a "Slowest Movers" table with recommended actions.
```

### Prompt 10 — Import CSV Page
```
Create src/pages/ImportCSV.jsx.
Drag-and-drop upload zone matching the Upload Zone spec in Section 10.
On file drop: call parseCSV(), show a preview table of parsed rows.
On confirm: call addSkus() from Zustand.
Show import history below (filename, date, SKU count, status chip).
```

---

## 12. Key Rules for Cursor

1. **Never hardcode lifecycle status** — always call `getLifecycleStatus()`
2. **Never rank by raw quantity** — always use sell-through % for bestsellers
3. **Match colors exactly** — use the hex values from Section 10, not approximations
4. **Fonts are non-negotiable** — Bebas Neue for all headings, DM Sans for body, JetBrains Mono for all data/SKU codes
5. **Animate on mount** — every page section should use fadeUp with staggered delays
6. **Progress bars animate** — always start at 0 width and transition to target on mount
7. **Build one component at a time** — never ask Cursor to build multiple pages in one prompt
8. **Reference this file** — start every Cursor chat with: *"We are building RetailOS. See CURSOR_CONTEXT.md. Now I need..."*

---

*RetailOS — Built for Driloni Sportswear · Internal Tool*
