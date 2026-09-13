// Lets someone draw a box around the setup code, because a whole screen holds more than one thing shaped like one

export type Selection = { x: number; y: number; width: number; height: number; ratio: number };

// Below this a drag is a misclick rather than a selection
const MIN_SIDE = 12;

const style = (element: HTMLElement, rules: Record<string, string>) => {
    for (const [name, value] of Object.entries(rules)) element.style.setProperty(name, value, "important");
};

/* Telling */

// The popup that started this closed the moment the page was clicked, so what went wrong is said on the page
export function sayOnPage(message: string): void {
    const note = document.createElement("div");
    style(note, {
        position: "fixed",
        top: "18px",
        left: "50%",
        transform: "translateX(-50%)",
        "z-index": "2147483647",
        padding: "10px 16px",
        "border-radius": "8px",
        background: "#241c19",
        border: "1px solid #4a3a33",
        color: "#e0b5a6",
        font: "14px system-ui, sans-serif",
    });
    note.textContent = message;
    document.documentElement.append(note);
    setTimeout(() => note.remove(), 6000);
}

/* Selecting */

// Resolves with the box in device pixels, or null if it was cancelled
export function cropSelection(): Promise<Selection | null> {
    return new Promise((resolve) => {
        const sheet = document.createElement("div");
        const box = document.createElement("div");
        const hint = document.createElement("div");

        style(sheet, {
            position: "fixed",
            inset: "0",
            "z-index": "2147483647",
            cursor: "crosshair",
            background: "rgba(10, 10, 10, 0.35)",
        });
        style(box, {
            position: "fixed",
            display: "none",
            border: "1px solid #e5e5de",
            "box-shadow": "0 0 0 9999px rgba(10, 10, 10, 0.35)",
            "pointer-events": "none",
        });
        style(hint, {
            position: "fixed",
            top: "18px",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "8px 14px",
            "border-radius": "8px",
            background: "#161616",
            color: "#ededeb",
            font: "14px system-ui, sans-serif",
            "pointer-events": "none",
        });
        hint.id = "rewall-crop-hint";
        hint.textContent = "Drag a box around the setup code, or press Escape";

        sheet.append(box, hint);
        document.documentElement.append(sheet);

        let from: { x: number; y: number } | null = null;

        // Taken off before anything is photographed, or the shot is of this dimming layer
        const finish = (selection: Selection | null) => {
            window.removeEventListener("keydown", onKey, true);
            sheet.remove();
            resolve(selection);
        };

        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            finish(null);
        };

        const draw = (to: { x: number; y: number }) => {
            if (!from) return;
            style(box, {
                display: "block",
                left: `${Math.min(from.x, to.x)}px`,
                top: `${Math.min(from.y, to.y)}px`,
                width: `${Math.abs(to.x - from.x)}px`,
                height: `${Math.abs(to.y - from.y)}px`,
            });
        };

        sheet.addEventListener("pointerdown", (event) => {
            from = { x: event.clientX, y: event.clientY };
            // Keeps the drag even when the pointer leaves the window, which is where a selection often ends
            sheet.setPointerCapture(event.pointerId);
            draw(from);
        });

        sheet.addEventListener("pointermove", (event) => draw({ x: event.clientX, y: event.clientY }));

        sheet.addEventListener("pointerup", (event) => {
            if (!from) return finish(null);
            const width = Math.abs(event.clientX - from.x);
            const height = Math.abs(event.clientY - from.y);
            if (width < MIN_SIDE || height < MIN_SIDE) return finish(null);

            // The screenshot comes back in device pixels, so the ratio travels with the box
            finish({
                x: Math.min(from.x, event.clientX),
                y: Math.min(from.y, event.clientY),
                width,
                height,
                ratio: window.devicePixelRatio || 1,
            });
        });

        window.addEventListener("keydown", onKey, true);
    });
}
