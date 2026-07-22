import { useEffect, useState } from "react";

const STORAGE_KEY = "horizon:plan-detail-open";

function readOpenMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, boolean>;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

function writeOpenMap(map: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** A4 — collapsible plan-detail section with remembered open state + id anchor. */
export function CollapsibleSection({
  id,
  title,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    const map = readOpenMap();
    return map[id] ?? defaultOpen;
  });

  useEffect(() => {
    // Deep-link: #plan-tax etc.
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (hash === id) setOpen(true);
  }, [id]);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      const map = readOpenMap();
      map[id] = next;
      writeOpenMap(map);
      return next;
    });
  };

  return (
    <section className="collapsible-section" id={id} data-testid={`section-${id}`}>
      <button
        type="button"
        className="collapsible-head"
        onClick={toggle}
        aria-expanded={open}
        data-testid={`toggle-${id}`}
      >
        <span className="collapsible-title">{title}</span>
        <span className="collapsible-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </section>
  );
}
