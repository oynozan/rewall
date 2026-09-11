"use client";

import { useCallback, useState, type ComponentProps } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import styles from "./select.module.css";

type Option = { value: string; label: string; disabled?: boolean };
type SelectProps = Pick<
    ComponentProps<typeof SelectPrimitive.Root>,
    "value" | "defaultValue" | "onValueChange" | "name" | "disabled" | "required"
> &
    Pick<ComponentProps<typeof SelectPrimitive.Trigger>, "id" | "aria-label" | "aria-describedby"> & {
        options: readonly Option[];
        placeholder?: string;
        className?: string;
        compact?: boolean;
    };

function Chevron({ up = false }: { up?: boolean }) {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d={up ? "M12 29l12-12 12 12" : "M12 19l12 12 12-12"} />
        </svg>
    );
}

export function Select({
    options,
    placeholder,
    className = "",
    compact = false,
    id,
    "aria-label": label,
    "aria-describedby": description,
    ...props
}: SelectProps) {
    const [container, setContainer] = useState<HTMLElement | undefined>(undefined);
    const [open, setOpen] = useState(false);
    // Native dialogs require their popovers to stay inside the top layer
    const triggerRef = useCallback((node: HTMLButtonElement | null) => {
        setContainer(node?.closest("dialog") ?? undefined);
    }, []);

    return (
        <SelectPrimitive.Root {...props} open={open} onOpenChange={setOpen}>
            <SelectPrimitive.Trigger
                ref={triggerRef}
                id={id}
                aria-label={label}
                aria-describedby={description}
                className={`${styles.trigger} ${compact ? styles.compact : ""} ${className}`}
            >
                <SelectPrimitive.Value placeholder={placeholder} />
                <SelectPrimitive.Icon className={styles.chevron}>
                    <Chevron />
                </SelectPrimitive.Icon>
            </SelectPrimitive.Trigger>
            <SelectPrimitive.Portal container={container}>
                <SelectPrimitive.Content
                    className={styles.content}
                    position="popper"
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    onEscapeKeyDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setOpen(false);
                    }}
                >
                    <SelectPrimitive.ScrollUpButton className={styles.scroll}>
                        <Chevron up />
                    </SelectPrimitive.ScrollUpButton>
                    <SelectPrimitive.Viewport className={styles.viewport}>
                        {options.map((option) => (
                            <SelectPrimitive.Item
                                key={option.value}
                                value={option.value}
                                disabled={option.disabled}
                                className={styles.item}
                            >
                                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                                <SelectPrimitive.ItemIndicator className={styles.indicator}>
                                    <svg
                                        width="15"
                                        height="15"
                                        viewBox="0 0 48 48"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2.4"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                    >
                                        <path d="m12 24 8 8 16-16" />
                                    </svg>
                                </SelectPrimitive.ItemIndicator>
                            </SelectPrimitive.Item>
                        ))}
                    </SelectPrimitive.Viewport>
                    <SelectPrimitive.ScrollDownButton className={styles.scroll}>
                        <Chevron />
                    </SelectPrimitive.ScrollDownButton>
                </SelectPrimitive.Content>
            </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
    );
}
