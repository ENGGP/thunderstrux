"use client";

import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { Field, control } from "@/components/ui/input";

// The house select: callers write the usual <option> and <optgroup> children,
// and get the design system's list instead of each browser's own popup. It is
// the ARIA select-only combobox: focus stays on the field while the arrows,
// Home/End, PageUp/PageDown and typed letters move through the list, Enter,
// Space or Tab chooses, Escape closes. A `name` submits the value through a
// hidden input, so it works in plain GET forms.

type Option = { value: string; label: string; group?: string };

type SelectControlProps = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  // The trigger's own look; the field style by default.
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  children: ReactNode;
};

function readOptions(children: ReactNode, group?: string): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string | number; label?: string; children?: ReactNode }>(child)) return [];
    if (child.type === "optgroup") return readOptions(child.props.children, child.props.label);
    const label = Children.toArray(child.props.children).join("");
    return [{ value: String(child.props.value ?? label), label, group }];
  });
}

export function Select({ label, hint, error, id, ...props }: Omit<SelectControlProps, "invalid" | "aria-label" | "aria-labelledby" | "aria-describedby"> & { label: string; hint?: string; error?: string }) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <Field error={error} hint={hint} id={fieldId} label={label}>
      {(describedBy) => <SelectControl aria-describedby={describedBy} aria-labelledby={`${fieldId}-label`} id={fieldId} invalid={Boolean(error)} {...props} />}
    </Field>
  );
}

export function SelectControl({ id, name, value: controlled, defaultValue, onChange, disabled, required, invalid, className, children, ...aria }: SelectControlProps) {
  const options = readOptions(children);
  const [own, setOwn] = useState(defaultValue ?? options[0]?.value ?? "");
  const value = controlled ?? own;
  const selected = Math.max(0, options.findIndex((option) => option.value === value));
  // How it was opened: the list animates in only for a pointer, never from the keyboard.
  const [open, setOpen] = useState<false | "pointer" | "keyboard">(false);
  const isOpen = Boolean(open);
  const [active, setActive] = useState(selected);
  const trigger = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  // A hover moves the highlight but never scrolls the list under the pointer.
  const hovered = useRef(false);
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;

  // A server page sends a new default when its URL changes: follow it.
  useEffect(() => {
    if (defaultValue !== undefined) setOwn(defaultValue);
  }, [defaultValue]);

  // A top-layer popover, so a scrolling table or a dialog never clips it; it
  // opens below the field, or above when there is more room there.
  useLayoutEffect(() => {
    const node = list.current;
    if (!isOpen || !node || !trigger.current) return;
    node.showPopover();
    const field = trigger.current;
    const place = () => {
      const rect = field.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const up = below < Math.min(node.scrollHeight, 288) + 8 && rect.top > below;
      // At least as wide as the field, wider for a long option, never past the screen.
      node.style.minWidth = `${rect.width}px`;
      node.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - node.offsetWidth - 8))}px`;
      node.style.top = up ? "auto" : `${rect.bottom + 4}px`;
      node.style.bottom = up ? `${window.innerHeight - rect.top + 4}px` : "auto";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      if (node.matches(":popover-open")) node.hidePopover();
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !hovered.current) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    hovered.current = false;
  }, [isOpen, active]);

  const show = (how: "pointer" | "keyboard", index = selected) => {
    setActive(index);
    setOpen(open || how);
  };
  const choose = (index: number) => {
    setOpen(false);
    const next = options[index]?.value;
    if (next === undefined || next === value) return;
    if (controlled === undefined) setOwn(next);
    onChange?.(next);
  };
  // Typed letters jump to the next option that starts with them; repeating one letter cycles.
  const typeAhead = (key: string) => {
    const now = Date.now();
    const text = (now - typed.current.at < 600 ? typed.current.text : "") + key.toLowerCase();
    typed.current = { text, at: now };
    const from = open ? active : selected;
    const repeat = [...text].every((letter) => letter === text[0]);
    const order = options.map((_, offset) => (from + offset + (repeat ? 1 : 0)) % options.length);
    const found = order.find((index) => options[index].label.toLowerCase().startsWith(repeat ? text[0] : text));
    if (found !== undefined) show("keyboard", found);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const last = options.length - 1;
    const go = (index: number) => {
      event.preventDefault();
      show("keyboard", Math.max(0, Math.min(last, index)));
    };
    const typing = Date.now() - typed.current.at < 600;
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key !== " " || typing)) {
      event.preventDefault();
      return typeAhead(event.key);
    }
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) go(selected);
      else if (event.key === "Home") go(0);
      else if (event.key === "End") go(last);
      return;
    }
    if (event.key === "ArrowDown") go(active + 1);
    else if (event.key === "ArrowUp" && event.altKey) {
      event.preventDefault();
      choose(active);
    } else if (event.key === "ArrowUp") go(active - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(last);
    else if (event.key === "PageDown") go(active + 10);
    else if (event.key === "PageUp") go(active - 10);
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") choose(active);
  };

  return (
    <div className="relative min-w-0">
      <div
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-controls={listId}
        aria-describedby={aria["aria-describedby"]}
        aria-disabled={disabled || undefined}
        aria-expanded={Boolean(open)}
        aria-haspopup="listbox"
        aria-invalid={invalid || undefined}
        aria-label={aria["aria-label"]}
        aria-labelledby={aria["aria-labelledby"]}
        aria-required={required || undefined}
        className={`flex cursor-pointer items-center justify-between gap-2 text-left aria-disabled:cursor-not-allowed ${
          className ?? `h-11 ${control} aria-disabled:border-line aria-disabled:bg-inert aria-disabled:text-ink-soft`
        }`}
        id={id}
        onBlur={() => setOpen(false)}
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else show("pointer");
        }}
        onKeyDown={onKeyDown}
        ref={trigger}
        role="combobox"
        tabIndex={disabled ? -1 : 0}
      >
        <span className="min-w-0 truncate">{options[selected]?.label}</span>
        <Icon className={`shrink-0 ${open ? "rotate-180" : ""}`} name="chevronDown" size={16} />
      </div>
      {name ? <input name={name} type="hidden" value={value} /> : null}
      <ul
        aria-labelledby={aria["aria-labelledby"]}
        aria-label={aria["aria-label"]}
        className={`m-0 max-h-72 w-max max-w-[calc(100vw-1rem)] overflow-y-auto rounded-card border border-line bg-surface p-1 text-ink shadow-[0_12px_32px_rgba(36,20,64,0.16)] inset-auto ${open === "pointer" ? "origin-top animate-pop-in" : ""}`}
        id={listId}
        // Keeps focus on the field, so choosing (or dragging the scrollbar) never blurs it.
        onMouseDown={(event) => event.preventDefault()}
        popover="manual"
        ref={list}
        role="listbox"
      >
        {options.map((option, index) => (
          <Fragment key={`${option.group ?? ""}-${option.value}`}>
            {option.group && option.group !== options[index - 1]?.group ? (
              <li aria-hidden="true" className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-muted" role="presentation">
                {option.group}
              </li>
            ) : null}
            <li
              aria-selected={index === selected}
              className={`flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-control px-3 py-2 text-sm ${index === active ? "bg-brand-tint text-brand-ink" : ""} ${index === selected ? "font-semibold text-brand-ink" : ""}`}
              id={optionId(index)}
              onClick={() => choose(index)}
              onPointerMove={() => {
                if (index === active) return;
                hovered.current = true;
                setActive(index);
              }}
              role="option"
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">{option.label}</span>
              {index === selected ? <Icon className="shrink-0 text-brand" name="check" size={16} /> : null}
            </li>
          </Fragment>
        ))}
      </ul>
    </div>
  );
}
