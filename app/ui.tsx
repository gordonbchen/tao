"use client";

// Shared UI primitives. Pages compose these and add only layout utilities.
// Follow the UI style guide in AGENTS.md before adding a variant or a new primitive.
import { useEffect, useRef, type ComponentProps, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { twMerge } from "tailwind-merge";

export function cn(...classes: (string | false | null | undefined)[]) {
  return twMerge(classes.filter(Boolean).join(" "));
}

const control = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-55";
const buttonVariants = {
  primary: "border-primary bg-primary text-on-primary hover:enabled:border-primary-hover hover:enabled:bg-primary-hover",
  secondary: "border-line bg-surface text-ink hover:enabled:border-line-strong hover:enabled:bg-hover",
  ghost: "border-transparent bg-transparent text-ink hover:enabled:bg-hover",
};
const buttonSizes = { md: "h-control px-4", sm: "h-control-sm px-3" };

type ButtonProps = ComponentProps<"button"> & { variant?: keyof typeof buttonVariants; size?: keyof typeof buttonSizes };

export function Button({ variant = "secondary", size = "md", type = "button", className, ...props }: ButtonProps) {
  return <button type={type} className={cn(control, buttonVariants[variant], buttonSizes[size], className)} {...props} />;
}

type IconButtonProps = Omit<ComponentProps<"button">, "aria-label"> & { label: string; tone?: "neutral" | "danger"; size?: "md" | "sm" | "xs" };
const iconSizes = { md: "size-control", sm: "size-control-sm", xs: "size-6" };

// Square icon-only button. `label` becomes both the accessible name and the tooltip.
export function IconButton({ label, tone = "neutral", size = "md", type = "button", className, ...props }: IconButtonProps) {
  return <button type={type} aria-label={label} title={label} className={cn(
    "inline-flex flex-none items-center justify-center rounded-md text-muted transition-colors disabled:cursor-not-allowed disabled:opacity-55",
    tone === "danger" ? "hover:enabled:bg-danger-soft hover:enabled:text-danger" : "hover:enabled:bg-hover hover:enabled:text-ink",
    iconSizes[size], className,
  )} {...props} />;
}

const field = "min-w-0 rounded-md border border-line bg-surface text-ink transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-55";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(field, "h-control px-3 text-sm", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(field, "h-control px-3 text-sm", className)} {...props} />;
}

// A labelled form control, with the label above it.
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-2 text-sm"><span className="text-muted">{label}</span>{children}</label>;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(field, "block w-full resize-y px-3 py-2 leading-relaxed", className)} {...props} />;
}

const badgeTones = { accent: "bg-accent-soft text-accent", neutral: "bg-subtle text-muted", danger: "bg-danger-soft text-danger" };

// Never wider than its container: long text, such as a topic name, is truncated.
export function Badge({ tone = "accent", className, children, ...props }: ComponentProps<"span"> & { tone?: keyof typeof badgeTones }) {
  return <span className={cn("inline-flex max-w-full min-w-0 flex-none items-center gap-1 rounded-full px-2 py-1 text-xs", badgeTones[tone], className)} {...props}><span className="truncate">{children}</span></span>;
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-4 flex-none animate-spin rounded-full border-2 border-line border-t-accent", className)} />;
}

export function ErrorMessage({ className, ...props }: ComponentProps<"p">) {
  return <p role="alert" className={cn("my-4 rounded-md border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger", className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-lg border border-line bg-surface", className)} {...props} />;
}

export function Page({ className, ...props }: ComponentProps<"main">) {
  return <main className={cn("mx-auto w-full max-w-4xl px-6 pt-12 pb-16 max-sm:px-4 max-sm:pt-6", className)} {...props} />;
}

type ModalProps = { title: ReactNode; label?: string; subtitle?: ReactNode; onClose: () => void; wide?: boolean; children: ReactNode };

// Dialog with a backdrop, title row, and close button. Escape and backdrop clicks close it.
// Open modals, innermost last: Escape closes only the top one, such as an enlarged figure over a viewer.
const openModals: object[] = [];

export function Modal({ title, label, subtitle, onClose, wide, children }: ModalProps) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const token = {};
    openModals.push(token);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && openModals.at(-1) === token) close.current(); };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); openModals.splice(openModals.indexOf(token), 1); };
  }, []);
  // Rendered into <body> so no ancestor's stacking context (a sticky chat, a card) can draw over it.
  // Wide dialogs fill the screen, less a margin, whatever they hold, so loading content or switching tabs never
  // resizes them. They are flex columns, so a panel that may shrink (min-h-0) can fill exactly the height left
  // under the title and tabs, like a viewer's chat.
  return createPortal(<div className={cn("fixed inset-0 z-20 grid place-items-center bg-backdrop p-6 max-sm:p-4", wide ? "overflow-hidden max-sm:p-0" : "overflow-auto")} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={label ?? (typeof title === "string" ? title : undefined)} className={cn(
      "w-full overflow-auto [scrollbar-gutter:stable] rounded-lg border border-line bg-paper p-6 shadow-float max-sm:p-4",
      wide ? "flex h-[calc(100dvh-48px)] max-w-7xl flex-col max-sm:h-dvh max-sm:rounded-none max-sm:border-0" : "max-h-[90vh] max-w-lg",
    )}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="min-w-0"><h2 className="text-xl font-semibold break-words">{title}</h2>{subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}</div>
        <IconButton label="Close" onClick={onClose}><X size={20} /></IconButton>
      </div>
      {children}
    </div>
  </div>, document.body);
}

export type MenuItem = { label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect: () => void };

// Right-click menu at a viewport point. Escape, an outside click, scrolling, or resizing closes it;
// arrow keys move between items.
export function ContextMenu({ x, y, label, items, onClose }: { x: number; y: number; label: string; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    // Keep the menu inside the viewport, then focus its first item for keyboard use.
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
    menu.querySelector<HTMLButtonElement>("button:enabled")?.focus();
    const dismiss = (event: Event) => { if (!(event.target instanceof Node && menu.contains(event.target))) close.current(); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close.current(); } };
    const onBlur = () => close.current();
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("scroll", onBlur, true);
    window.addEventListener("resize", onBlur);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("scroll", onBlur, true);
      window.removeEventListener("resize", onBlur);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [x, y]);
  const moveFocus = (event: ReactKeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:enabled") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };
  return <div ref={ref} role="menu" aria-label={label} onKeyDown={moveFocus} onContextMenu={(event) => event.preventDefault()}
    className="fixed z-30 min-w-48 rounded-md border border-line bg-paper p-1 shadow-float" style={{ left: x, top: y }}>
    {items.map((item) => <button key={item.label} type="button" role="menuitem" disabled={item.disabled}
      onClick={() => { onClose(); item.onSelect(); }}
      className={cn("flex h-control-sm w-full items-center gap-2 rounded-md px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        item.danger ? "hover:enabled:bg-danger-soft hover:enabled:text-danger focus-visible:text-danger" : "hover:enabled:bg-hover")}>
      {item.icon && <span className="flex-none text-muted">{item.icon}</span>}{item.label}
    </button>)}
  </div>;
}

type Tab<T extends string> = { id: T; label: string; count?: number };

// Underlined tab list. Pages that use it own its keyboard shortcuts.
// `actions` sit at the right end of the tab row.
export function Tabs<T extends string>({ tabs, value, onChange, label, actions, className }: { tabs: Tab<T>[]; value: T; onChange: (id: T) => void; label: string; actions?: ReactNode; className?: string }) {
  return <div className={cn("-mt-2 mb-4 flex items-center gap-6 border-b border-line max-sm:gap-4", className)}><div role="tablist" aria-label={label} className="flex min-w-0 gap-6 max-sm:gap-4">
    {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={value === tab.id} tabIndex={value === tab.id ? 0 : -1}
      onClick={() => onChange(tab.id)}
      className={cn("-mb-px inline-flex h-control items-center gap-2 border-b-2 whitespace-nowrap px-1 text-sm transition-colors", value === tab.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}>
      {tab.label}{tab.count !== undefined && <span className="text-xs text-muted max-sm:hidden">{tab.count.toLocaleString()}</span>}
    </button>)}
  </div>{actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}</div>;
}

// Bordered row list used for subjects, topics, resources, and dialog choices.
export function List({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("border-t border-line", className)} {...props} />;
}

export function ListItem({ className, ...props }: ComponentProps<"li">) {
  return <li className={cn("flex min-h-14 items-center gap-3 border-b border-line py-2", className)} {...props} />;
}

// Selectable option button (ratings, reasons). Pressed state is carried by aria-pressed.
export function ToggleButton({ pressed, className, ...props }: ButtonProps & { pressed: boolean }) {
  return <Button size="sm" aria-pressed={pressed} className={cn("aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent", className)} {...props} />;
}
