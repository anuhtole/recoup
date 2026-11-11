// Prototype only: Recoup's Overview built from real Astryx components (direction 3).
// Loaded from a CDN so nothing is installed; React 19 here is separate from the app's React 18.
import * as React from "https://esm.sh/react@19.2.0";
import { createRoot } from "https://esm.sh/react-dom@19.2.0/client";
import * as A from "https://esm.sh/@astryxdesign/core@0.7.11?deps=react@19.2.0,react-dom@19.2.0";

const e = React.createElement;
const { AppShell, SideNav, SideNavItem, Heading, Text, Button, Badge, Table, TabList, Tab, Dialog, HStack, VStack, Divider } = A;
window.__astryx = A;

const TYPES = {
  duplicate_charge: "Duplicate charge",
  missing_refund: "Missing refund",
  price_increase: "Price increase",
  sla_credit: "SLA credit",
  unused_seats: "Unused seats",
};
const money = (minor) => (minor / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const day = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const typeName = (t) => TYPES[t] ?? t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function Overview() {
  const [rows, setRows] = React.useState([]);
  const [summary, setSummary] = React.useState(null);
  const [tab, setTab] = React.useState("todo");
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/findings").then((r) => r.json()).then(setRows);
    fetch("/api/summary").then((r) => r.json()).then(setSummary);
  }, []);

  const todo = rows.filter((r) => r.stage === "todo" && r.outcome !== "not_recoverable" && r.days_left >= 0);
  const shown = (tab === "todo" ? todo : rows.filter((r) => r.stage === tab)).slice().sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999));
  const total = todo.reduce((s, r) => s + r.amount_minor, 0);
  const urgent = todo.filter((r) => r.days_left != null && r.days_left <= 3).length;

  const columns = [
    {
      key: "merchant",
      header: "Vendor",
      renderCell: (r) =>
        e("span", { className: "mock-row" },
          e(Text, { type: "body", weight: "medium" }, r.merchant),
          r.outcome === "needs_review" ? e(Badge, { variant: "warning", label: "Needs review" }) : null),
    },
    { key: "leak_type", header: "Type", renderCell: (r) => e(Text, { type: "body", color: "secondary" }, typeName(r.leak_type)) },
    {
      key: "recover_by",
      header: "Respond by",
      renderCell: (r) =>
        e("span", { className: "mock-row" },
          e("span", { className: "mock-num" }, day(r.recover_by)),
          r.days_left <= 3
            ? e(Badge, { variant: "warning", label: r.days_left === 1 ? "1 day left" : `${r.days_left} days left` })
            : e(Text, { type: "body", color: "secondary" }, `${r.days_left} days`)),
    },
    { key: "amount_minor", header: "Amount", align: "end", renderCell: (r) => e("span", { className: "mock-num" }, money(r.amount_minor)) },
  ];

  const nav = e(SideNav, { label: "Main", header: e(VStack, { gap: 0 }, e(Text, { type: "body", weight: "semibold" }, "Recoup"), e(Text, { type: "body", color: "secondary" }, summary?.org_name ?? "Acme Inc.")) },
    e(SideNavItem, { label: "Overview", href: "#", isSelected: true }),
    e(SideNavItem, { label: "Claims", href: "#", endContent: e(Badge, { label: String(todo.length) }) }),
    e(SideNavItem, { label: "Recovered", href: "#" }),
    e(SideNavItem, { label: "Sources", href: "#" }));

  return e(AppShell, { sideNav: nav, height: "fill", contentPadding: 6 },
    e(VStack, { gap: 6 },
      e(HStack, { gap: 3, align: "center", justify: "between" },
        e(Heading, { level: 1 }, "Overview"),
        e(HStack, { gap: 2 },
          e(Button, { variant: "secondary", label: "Export" }),
          e(Button, { variant: "primary", label: "Review claims", onClick: () => setOpen(true) }))),
      e(VStack, { gap: 1 },
        e(Text, { type: "body", color: "secondary" }, "Open claims"),
        e("div", { className: "mock-figure" }, money(total)),
        e(HStack, { gap: 2, align: "center" },
          e(Text, { type: "body", color: "secondary" }, `${todo.length} claims`),
          urgent ? e(Badge, { variant: "warning", label: `${urgent} expire${urgent === 1 ? "s" : ""} within 3 days` }) : null,
          summary ? e(Text, { type: "body", color: "secondary" }, `Missed ${money(summary.expired_minor)}`) : null)),
      e(Divider, null),
      e(TabList, { value: tab, onChange: setTab, hasDivider: true },
        e(Tab, { value: "todo", label: `To do ${todo.length}` }),
        e(Tab, { value: "waiting", label: "Waiting" }),
        e(Tab, { value: "done", label: "Done" })),
      e(Table, { data: shown.slice(0, 8), columns, hasHover: true })),
    e(Dialog, { isOpen: open, onOpenChange: setOpen, width: 440 },
      e(VStack, { gap: 4, padding: 5 },
        e(Heading, { level: 2 }, "Send request to Figma?"),
        e(Text, { type: "body", color: "secondary" }, "Sends to billing@figma.com. This can't be edited after it's sent."),
        e(HStack, { gap: 2, justify: "end" },
          e(Button, { variant: "secondary", label: "Cancel", onClick: () => setOpen(false) }),
          e(Button, { variant: "primary", label: "Send request", onClick: () => setOpen(false) })))));
}

createRoot(document.getElementById("root")).render(e(Overview));

// Look switcher (prototype chrome).
const look = document.getElementById("look");
look.addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-look]");
  if (!b) return;
  document.documentElement.classList.toggle("recoup", b.dataset.look === "recoup");
  look.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
});
