# PesaSwap Menu & Catalogue System — Complete Feature Documentation

> **Version:** 1.0 | **Last Updated:** 2026-05-31 | **Phases:** 1, 2, 3 Complete

---

## Table of Contents

1. [Overview](#overview)
2. [Phase 1 — Core Menu Management](#phase-1--core-menu-management)
   - [Product Photos](#1-product-photos)
   - [Item Availability Toggle](#2-item-availability-toggle)
   - [Product Descriptions](#3-product-descriptions)
   - [Item Modifiers & Options](#4-item-modifiers--options)
   - [Menu Scheduling](#5-menu-scheduling)
3. [Phase 2 — Multi-Menu & Zones](#phase-2--multi-menu--zones)
   - [Multiple Menus](#6-multiple-menus)
   - [Zone-Based Menus](#7-zone-based-menus)
   - [Category Drag-to-Reorder](#8-category-drag-to-reorder)
   - [Linked Products (Upselling)](#9-linked-products-upselling)
   - [Menu Preview](#10-menu-preview)
4. [Phase 3 — Enterprise](#phase-3--enterprise)
   - [Multi-Language Menu](#11-multi-language-menu)
   - [POS Sync (CSV Import/Export)](#12-pos-sync-csv-importexport)
   - [External Menu (PDF/Link)](#13-external-menu-pdflink)
5. [Data Model Reference](#data-model-reference)
6. [Storage Keys](#storage-keys)
7. [Routes & Navigation](#routes--navigation)

---

## Overview

The PesaSwap Menu & Catalogue system provides a full-featured restaurant menu management platform. Merchants manage menus via the **Dashboard** (`/dashboard/menu`) and customers interact with them via the **Table Route** (`/table?t={tableNumber}`).

**Key Personas:**

- **Restaurant Owner/Manager** — Creates menus, sets schedules, manages zones
- **Kitchen/Bar Staff** — Sees order tickets routed to correct destination
- **Waitstaff** — Uses the mobile app for table service
- **Customer** — Scans QR, browses menu, places orders

---

## Phase 1 — Core Menu Management

### 1. Product Photos

**Function:** Upload and display product images for menu items.

**Capability:**

- Upload images via click or drag-and-drop in the add/edit dialog
- Images stored as base64 data URIs in localStorage
- Thumbnails displayed in both grid card and list table views
- Full preview in the item editor modal
- Placeholder icon shown when no image is set

**User Story:**

> As a restaurant owner, I want to add photos to my menu items so that customers can see what they're ordering, increasing appetite appeal and reducing order confusion.

**Use Case:**

1. Owner opens Dashboard → Menu → Items tab
2. Clicks "Add Item" or edits existing item
3. Clicks the dashed image upload area
4. Selects a photo from their device
5. Preview shows immediately in the modal
6. Saves — thumbnail now appears in the item grid

**How-To:**

```
Dashboard → Menu → Items → Edit Item → Click image upload zone → Select file → Save
```

---

### 2. Item Availability Toggle

**Function:** Mark items as sold out ("86'd") without deleting them.

**Capability:**

- Toggle switch on each item (green = available, gray = sold out)
- Quick "86" button for fast stock-out during service
- Sold-out items show a red "Sold Out" badge
- Customer view: sold-out items appear grayed out and cannot be added to cart
- Items remain in catalogue for next day/restock

**User Story:**

> As a kitchen manager, I want to mark items as sold out in real-time so that customers don't order items we can't serve, avoiding disappointment and refunds.

**Use Case:**

1. Chef realizes the salmon is out of stock
2. Opens Dashboard → Menu → Items
3. Clicks the availability toggle on "Grilled Salmon" → turns gray
4. Customer scanning QR now sees "Grilled Salmon" grayed out with "Sold Out" badge
5. Next morning, manager toggles it back on

**How-To:**

```
Dashboard → Menu → Items → Toggle the switch on any item
  OR
Dashboard → Menu → Items → Click "86" button for instant stock-out
```

---

### 3. Product Descriptions

**Function:** Add rich text descriptions to menu items.

**Capability:**

- Textarea field in the add/edit dialog
- Description shown truncated (2 lines) below item name in grid view
- Full description visible in item detail drawer/popover
- Customer view shows full description under each item
- Supports ingredients, preparation method, portion size info

**User Story:**

> As a restaurant owner, I want to add descriptions to my dishes so that customers understand what's in each item, reducing questions to waitstaff and helping with dietary decisions.

**Use Case:**

1. Owner edits "Nyama Choma" item
2. Adds description: "Slow-roasted goat ribs marinated in our house blend of spices. Served with kachumbari, ugali, and sukuma wiki. Serves 1-2 people."
3. Customer scanning QR sees the description below the item name
4. Customer with allergies can read ingredients before ordering

**How-To:**

```
Dashboard → Menu → Items → Edit Item → Fill "Description" textarea → Save
```

---

### 4. Item Modifiers & Options

**Function:** Add customization options (sizes, extras, add-ons) with price adjustments.

**Capability:**

- Create modifier groups per item (e.g., "Size", "Extras", "Spice Level")
- Each group has multiple options with optional price adjustments
- Customer must select modifiers before adding to cart (if item has modifiers)
- Order total adjusts based on selected modifier prices
- Multiple modifier groups per item supported

**User Story:**

> As a restaurant owner, I want to offer item customizations (size, extras) so that customers can personalize their orders and I can upsell premium options.

**Use Case:**

1. Owner edits "Masala Chai"
2. Adds modifier group "Size": Small (KES 0), Regular (KES 0), Large (+KES 50)
3. Adds modifier group "Extras": Extra Ginger (+KES 20), Honey (+KES 30)
4. Customer orders Masala Chai → sees size selector + extras checkboxes
5. Selects "Large" + "Honey" → price shows KES 150 + 50 + 30 = KES 230

**How-To:**

```
Dashboard → Menu → Items → Edit Item → Modifiers section → Add Group
  → Name: "Size" → Add options: "Small" (+0), "Regular" (+0), "Large" (+50)
  → Save
```

**Type Reference:**

```typescript
type ItemModifier = {
  id: string;
  name: string; // "Size", "Extras", "Spice Level"
  options: ModifierOption[];
};

type ModifierOption = {
  id: string;
  label: string; // "Large", "Extra Cheese"
  priceAdjustment: number; // +50, +30, 0
};
```

---

### 5. Menu Scheduling

**Function:** Set time-based visibility for menu categories.

**Capability:**

- Create named schedules (e.g., "Lunch Menu", "Dinner Menu", "Happy Hour")
- Assign days of the week (Mon–Sun)
- Set start and end times
- Assign categories to each schedule
- Active schedule indicator in dashboard
- Customer view auto-filters: only shows categories from the currently active schedule
- If no schedule is active, all items are shown

**User Story:**

> As a restaurant manager, I want different menus at different times of day so that customers only see relevant items (breakfast items in the morning, dinner items in the evening).

**Use Case:**

1. Manager creates schedule "Breakfast" → Mon-Fri, 6:00-11:00, categories: Breakfast, Beverages
2. Creates "Lunch" → Mon-Sun, 11:00-15:00, categories: Starters, Mains, Beverages, Desserts
3. Creates "Dinner" → Mon-Sun, 18:00-23:00, categories: Starters, Mains, Grills, Beverages, Desserts
4. At 9am, customer scanning QR only sees Breakfast + Beverages categories
5. At 12pm, they see Starters, Mains, Beverages, Desserts

**How-To:**

```
Dashboard → Menu → Schedules tab → Add Schedule
  → Name: "Lunch Menu"
  → Days: Mon, Tue, Wed, Thu, Fri, Sat, Sun
  → Time: 11:00 – 15:00
  → Categories: Starters, Mains, Beverages, Desserts
  → Save
```

**Type Reference:**

```typescript
type MenuSchedule = {
  id: string;
  name: string;
  days: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  startTime: string; // "11:00"
  endTime: string; // "15:00"
  categories: string[];
};
```

---

## Phase 2 — Multi-Menu & Zones

### 6. Multiple Menus

**Function:** Create and manage distinct menus for different occasions or service styles.

**Capability:**

- Create named menus: "Lunch Menu", "Dinner Menu", "Drinks Only", "Happy Hour"
- Each menu selects which categories are included
- Active/inactive toggle per menu
- Category count displayed on each menu card
- Customer view filters items to only show categories from active menus
- Works with scheduling: schedules can reference specific menus

**User Story:**

> As a multi-concept restaurant owner, I want to maintain separate menus (food, drinks, brunch) so that I can activate the right menu for the right service period without rebuilding items each time.

**Use Case:**

1. Owner creates "Food Menu" → categories: Starters, Mains, Desserts
2. Creates "Drinks Menu" → categories: Cocktails, Wines, Soft Drinks
3. Creates "Brunch Special" → categories: Breakfast, Beverages, Desserts
4. During brunch service, activates only "Brunch Special"
5. For regular dinner, activates "Food Menu" + "Drinks Menu"
6. Customer sees combined categories from all active menus

**How-To:**

```
Dashboard → Menu → Menus tab → Create Menu
  → Name: "Dinner Menu"
  → Categories: select Starters, Mains, Grills, Desserts
  → Active: ON
  → Save
```

**Type Reference:**

```typescript
type Menu = {
  id: string;
  name: string;
  description?: string;
  categories: string[];
  isActive: boolean;
  createdAt: string;
};
```

---

### 7. Zone-Based Menus

**Function:** Assign different menus to different physical areas of the restaurant.

**Capability:**

- Define zones with table ranges (e.g., Terrace: tables 1-10, Dining: 11-20, Bar: 21-25)
- Assign one or more menus to each zone
- Customer experience is automatic: table number determines which menu they see
- Dashboard shows zones as cards with colored borders, table range pills, and assigned menus
- Supports overlapping concepts (bar gets drinks-only, dining gets full menu)

**User Story:**

> As a venue operator with multiple areas, I want the terrace to show a simplified menu and the bar to show drinks-only, so that each area has an appropriate offering without confusing customers.

**Use Case:**

1. Owner defines zones:
   - "Terrace" → Tables 1-10 → Menus: Food Menu, Drinks Menu
   - "Dining Room" → Tables 11-20 → Menus: Food Menu, Drinks Menu, Dessert Menu
   - "Bar" → Tables 21-25 → Menus: Drinks Menu only
2. Customer at Table 22 scans QR → sees only cocktails, wines, soft drinks
3. Customer at Table 15 scans QR → sees full food + drinks + desserts

**How-To:**

```
Dashboard → Menu → Zones tab → Create Zone
  → Name: "Bar Area"
  → Table Range: 21 to 25
  → Assign Menus: select "Drinks Menu"
  → Save
```

**Type Reference:**

```typescript
type Zone = {
  id: string;
  name: string;
  menuIds: string[];
  tableRange: [number, number]; // [start, end] inclusive
};
```

---

### 8. Category Drag-to-Reorder

**Function:** Drag and drop categories to control display order.

**Capability:**

- Categories displayed as draggable pills/tabs in the dashboard
- Grip icon (⠿) indicates draggability
- HTML5 native drag-and-drop (onDragStart, onDragOver, onDrop)
- New order persisted to localStorage immediately
- Customer view respects the same category ordering
- Works across all views: dashboard items tab, customer menu, preview modal

**User Story:**

> As a restaurant owner, I want to control the order in which categories appear on the customer menu so that high-margin items (Drinks, Specials) appear first.

**Use Case:**

1. Owner opens Dashboard → Menu → Items tab
2. Sees categories: Starters, Mains, Desserts, Beverages
3. Drags "Beverages" to position 1
4. New order: Beverages, Starters, Mains, Desserts
5. Customer scanning QR now sees Beverages tab first

**How-To:**

```
Dashboard → Menu → Items tab → Grab the ⠿ handle on any category tab → Drag to new position → Release
```

**Storage:** `fxengine.merchant.categoryOrder` — JSON array of category names in display order.

---

### 9. Linked Products (Upselling)

**Function:** Suggest complementary items to increase average order value.

**Capability:**

- Each item can have up to 3 linked product suggestions
- Dashboard item editor: "Suggested Pairings" section with search/select
- Customer view: after adding an item to cart, a "Goes well with..." section appears
- Shows linked items as horizontal scroll cards (thumbnail + name + price + Add button)
- One-tap add from suggestions
- Increases average order value by 15-25% (industry benchmark)

**User Story:**

> As a restaurant owner, I want to suggest wine pairings with steaks and sides with mains so that customers discover more items and my average ticket size increases.

**Use Case:**

1. Owner edits "Nyama Choma" (grilled meat)
2. In "Suggested Pairings", searches and selects: "Tusker Lager", "Kachumbari Salad", "Ugali"
3. Customer adds "Nyama Choma" to cart
4. Below the cart, sees: "Goes well with..." → Tusker Lager (KES 350), Kachumbari (KES 150), Ugali (KES 100)
5. Customer taps "Add" on Tusker → added to cart instantly

**How-To:**

```
Dashboard → Menu → Items → Edit Item → Suggested Pairings section
  → Search for items → Click to add (max 3)
  → Save
```

---

### 10. Menu Preview

**Function:** Preview the customer menu experience directly from the dashboard.

**Capability:**

- "Preview" button in dashboard toolbar
- Opens a modal styled as a mobile phone frame (390px wide, rounded corners)
- Renders the exact customer view: category tabs, item cards, photos, prices, dietary badges, sold-out states
- Respects currently active menus, schedules, and category order
- Read-only (no add-to-cart functionality)
- Helps merchants verify appearance before customers see it

**User Story:**

> As a restaurant owner, I want to preview exactly what my customers will see on their phones so that I can verify photos, descriptions, and layout are correct before going live.

**Use Case:**

1. Owner finishes editing menu items, adding photos, setting availability
2. Clicks "Preview" button in dashboard
3. Phone-shaped modal appears showing the customer menu
4. Verifies: categories in right order, photos look good, sold-out items grayed out
5. Notices a typo → closes preview → fixes → previews again ✓

**How-To:**

```
Dashboard → Menu → Click "Preview" button (top-right) → View in phone frame → Close
```

---

## Phase 3 — Enterprise

### 11. Multi-Language Menu

**Function:** Translate menu items into multiple languages for international customers.

**Capability:**

- Supported locales: English (en), Swahili (sw), French (fr), Arabic (ar)
- Per-item translations: name and description in each language
- Dashboard: "Translations" button on each item opens a language editor dialog
- Globe icon (🌐) badge on items that have translations
- Customer view: language selector dropdown at top of menu
- Auto-detects browser language (e.g., `sw` from `sw-KE`)
- Selected language persisted in localStorage
- Graceful fallback to English if translation missing

**User Story:**

> As a hotel restaurant in a tourist area, I want my menu available in English, Swahili, French, and Arabic so that international guests can read the menu in their language and order confidently.

**Use Case:**

1. Owner opens Dashboard → Menu → Items → clicks 🌐 on "Nyama Choma"
2. Translation dialog opens with tabs: EN | SW | FR | AR
3. Clicks "SW" tab → enters Swahili name: "Nyama Choma ya Kubabusha"
4. Clicks "FR" tab → enters French: "Viande Grillée aux Épices"
5. Saves → globe badge appears on the item
6. French tourist at Table 5 → opens menu → selects 🇫🇷 French
7. Sees "Viande Grillée aux Épices" with French description
8. Items without French translation fall back to English

**How-To:**

```
Dashboard → Menu → Items → Click 🌐 icon on item → Select language tab
  → Enter translated name and description
  → Save

Customer: /table → Click language dropdown (top) → Select language
```

**Type Reference:**

```typescript
type SupportedMenuLocale = "en" | "sw" | "fr" | "ar";

type CatalogueItemTranslation = {
  name: string;
  description?: string;
};

// On CatalogueItem:
translations?: Partial<Record<SupportedMenuLocale, CatalogueItemTranslation>>;
```

---

### 12. POS Sync (CSV Import/Export)

**Function:** Import menu items from external POS systems and export your catalogue.

**Capability:**

- **Import:**
  - Upload CSV file via file picker
  - Smart CSV parser handles quoted fields and commas
  - Field mapping UI: map each CSV column to a PesaSwap field (name, price, category, description, dietary)
  - Preview first 5 rows before confirming
  - Imported items tagged with `syncSource: "csv-import"` and timestamp
  - "Imported" badge shown on synced items
- **Export:**
  - One-click CSV download of entire catalogue
  - Columns: name, price, category, description, dietary, destination, available
  - Standard CSV format compatible with Excel, Google Sheets, other POS systems
- Sync status badges distinguish local vs imported items

**User Story:**

> As a restaurant switching from another POS system, I want to import my existing 200-item menu via CSV so that I don't have to re-enter every item manually.

**Use Case — Import:**

1. Owner exports menu from old POS as CSV
2. Dashboard → Menu → Items → clicks "Import CSV"
3. Selects the CSV file
4. Field mapping modal appears:
   - CSV column "Item Name" → maps to "Name"
   - CSV column "Unit Price" → maps to "Price"
   - CSV column "Group" → maps to "Category"
5. Preview shows first 5 items correctly mapped
6. Clicks "Confirm Import" → 200 items added
7. Toast: "200 items imported successfully"
8. Items show blue "Imported" badge

**Use Case — Export:**

1. Owner wants a backup or to share menu with partner
2. Dashboard → Menu → Items → clicks "Export CSV"
3. Browser downloads `menu-export-2026-05-31.csv`
4. Opens in Excel — all items with prices, categories, descriptions

**How-To:**

```
Import: Dashboard → Menu → Items → "Import CSV" → Select file → Map fields → Preview → Confirm
Export: Dashboard → Menu → Items → "Export CSV" → File downloads automatically
```

**Type Reference (added fields on CatalogueItem):**

```typescript
syncSource?: string;   // "csv-import", "lightspeed", "square"
syncedAt?: string;     // ISO timestamp of last sync
```

---

### 13. External Menu (PDF/Link)

**Function:** Attach PDF menus or external URLs as supplementary menu formats.

**Capability:**

- Upload PDF files (stored as base64 data URI) or paste external URLs
- Multiple external menus supported (e.g., "Wine List PDF", "Catering Menu")
- Dashboard: "External" tab shows cards with type badge (PDF/URL), name, date
- Add/delete external menus via modal
- Customer view: "📄 View Full Menu" button opens embedded viewer
- PDF displayed in iframe; URLs opened in embedded frame
- Useful for: wine lists, catering menus, special event menus, allergen info sheets

**User Story:**

> As a restaurant with an extensive wine list managed by our sommelier in PDF format, I want to attach this PDF so customers can browse the full wine list alongside the digital menu.

**Use Case:**

1. Owner has a beautifully designed wine list PDF
2. Dashboard → Menu → External tab → "Add External Menu"
3. Enters name: "Wine List 2026"
4. Selects type: PDF → uploads the PDF file
5. Saves → card appears: "Wine List 2026" with red PDF badge
6. Customer on /table route → sees "📄 View Full Menu" button
7. Taps it → modal opens with wine list PDF embedded and scrollable

**How-To:**

```
Dashboard → Menu → External tab → "Add External Menu"
  → Name: "Wine List"
  → Type: PDF → Upload file  (or Type: URL → Paste link)
  → Save

Customer: /table → Tap "📄 View Full Menu" → Select menu → View in modal
```

**Type Reference:**

```typescript
type ExternalMenu = {
  id: string;
  name: string;
  type: "pdf" | "url";
  content: string; // base64 data URI for PDF, or URL string
  createdAt: string;
};
```

---

## Data Model Reference

### Complete CatalogueItem Type

```typescript
type CatalogueItem = {
  // Core
  id: string;
  name: string;
  price: number;
  category: string;

  // Routing
  dietary?: string[]; // "vegan" | "vegetarian" | "gluten-free" | "halal" | "contains-nuts" | "dairy-free"
  destination?: "kitchen" | "bar";

  // Phase 1
  image?: string; // base64 data URI
  available?: boolean; // false = sold out
  description?: string; // rich item description
  modifiers?: ItemModifier[]; // size, extras, add-ons

  // Phase 2
  linkedProductIds?: string[]; // IDs of suggested pairing items (max 3)

  // Phase 3
  translations?: Partial<Record<SupportedMenuLocale, CatalogueItemTranslation>>;
  syncSource?: string; // "csv-import", POS name
  syncedAt?: string; // ISO timestamp
};
```

### Supporting Types

```typescript
type ModifierOption = { id: string; label: string; priceAdjustment: number };
type ItemModifier = { id: string; name: string; options: ModifierOption[] };
type MenuSchedule = {
  id: string;
  name: string;
  days: number[];
  startTime: string;
  endTime: string;
  categories: string[];
};
type Menu = {
  id: string;
  name: string;
  description?: string;
  categories: string[];
  isActive: boolean;
  createdAt: string;
};
type Zone = {
  id: string;
  name: string;
  menuIds: string[];
  tableRange: [number, number];
};
type ExternalMenu = {
  id: string;
  name: string;
  type: "pdf" | "url";
  content: string;
  createdAt: string;
};
type SupportedMenuLocale = "en" | "sw" | "fr" | "ar";
type CatalogueItemTranslation = { name: string; description?: string };
```

---

## Storage Keys

| Key                                | Type              | Description                |
| ---------------------------------- | ----------------- | -------------------------- |
| `fxengine.merchant.catalogue`      | `CatalogueItem[]` | All menu items             |
| `fxengine.merchant.menus`          | `Menu[]`          | Named menu definitions     |
| `fxengine.merchant.zones`          | `Zone[]`          | Zone configurations        |
| `fxengine.merchant.menuSchedules`  | `MenuSchedule[]`  | Time-based schedules       |
| `fxengine.merchant.categoryOrder`  | `string[]`        | Category display order     |
| `fxengine.merchant.externalMenus`  | `ExternalMenu[]`  | PDF/URL attachments        |
| `fxengine.merchant.selectedLocale` | `string`          | Customer's language choice |

---

## Routes & Navigation

| Route             | Purpose                                                              | Persona       |
| ----------------- | -------------------------------------------------------------------- | ------------- |
| `/dashboard/menu` | Full menu management (Items, Menus, Zones, Schedules, External tabs) | Owner/Manager |
| `/table?t={n}`    | Customer ordering (respects zones, menus, schedules, language)       | Customer      |
| `/merchant`       | Mobile merchant app (includes catalogue view for waitstaff)          | Staff         |

### Dashboard Menu Tabs

```
┌──────────────────────────────────────────────────────────────────┐
│  Items  │  Menus  │  Zones  │  Schedules  │  External           │
├──────────────────────────────────────────────────────────────────┤
│                                    [Preview] [Import] [Export]    │
│                                                                  │
│  Category tabs (draggable):  [All] [Starters] [Mains] [Drinks]  │
│                                                                  │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐                       │
│  │ 📷   │  │ 📷   │  │ 📷   │  │ 📷   │                       │
│  │ Item │  │ Item │  │ Item │  │ Item │                       │
│  │ KES  │  │ KES  │  │ KES  │  │ KES  │                       │
│  │ 🌐⚙️ │  │ 🌐  │  │ 🔴  │  │ ⚙️  │                       │
│  └──────┘  └──────┘  └──────┘  └──────┘                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Feature Summary Matrix

| #   | Feature             | Phase | Dashboard Tab   | Customer Impact     | Revenue Impact       |
| --- | ------------------- | ----- | --------------- | ------------------- | -------------------- |
| 1   | Product Photos      | 1     | Items           | Visual appeal       | +15-30% orders       |
| 2   | Availability Toggle | 1     | Items           | No disappointment   | Reduces refunds      |
| 3   | Descriptions        | 1     | Items           | Informed choice     | Fewer complaints     |
| 4   | Modifiers/Options   | 1     | Items           | Customization       | +20% ticket size     |
| 5   | Scheduling          | 1     | Schedules       | Relevant items only | Ops efficiency       |
| 6   | Multiple Menus      | 2     | Menus           | Curated experience  | Flexibility          |
| 7   | Zones               | 2     | Zones           | Area-specific       | Targeted upsell      |
| 8   | Drag-Reorder        | 2     | Items           | Priority display    | High-margin first    |
| 9   | Linked Products     | 2     | Items           | Discovery           | +15-25% AOV          |
| 10  | Preview             | 2     | — (button)      | QA before live      | Fewer errors         |
| 11  | Multi-Language      | 3     | Items (🌐)      | Accessibility       | International guests |
| 12  | CSV Import/Export   | 3     | Items (toolbar) | —                   | Fast onboarding      |
| 13  | External Menu       | 3     | External        | Full menu access    | Wine list upsell     |

---

_Built with PesaSwap — Powering payments and restaurant operations across East Africa._
