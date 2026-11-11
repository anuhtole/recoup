// Prototype only: the real app with three colour looks laid over it (see colour.css).
// The switcher sets data-look on <html>; ?look=paper|paper-a|paper-b|paper-c picks the start. Nothing in the app imports this.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/App";
import "./colour.css";

const LOOKS = [
  { key: "", label: "Current" },
  { key: "paper", label: "1 · Paper" },
  { key: "paper-a", label: "1A · More mint" },
  { key: "paper-b", label: "1B · White + green" },
  { key: "paper-c", label: "1C · Mint hero" },
  { key: "paper-d", label: "1D · Stripe-style" },
];

const html = document.documentElement;
const bar = document.getElementById("look");
const root = document.getElementById("root");
if (!bar || !root) throw new Error("Missing #look or #root");

function show(key: string) {
  if (key) html.dataset.look = key;
  else delete html.dataset.look;
  bar?.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.look === key)));
  const url = new URL(location.href);
  if (key) url.searchParams.set("look", key);
  else url.searchParams.delete("look");
  history.replaceState(null, "", url);
}

for (const look of LOOKS) {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.look = look.key;
  b.textContent = look.label;
  b.addEventListener("click", () => show(look.key));
  bar.appendChild(b);
}
const start = new URLSearchParams(location.search).get("look") ?? "";
show(LOOKS.some((l) => l.key === start) ? start : "");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
