// Writes a code into a field the page owns. Pure DOM, no extension APIs, so it runs anywhere a page does.

import type { OtpField } from "./detect.ts";

const bubbles = { bubbles: true, composed: true } as const;

/* One field */

// Blink builds the events for insertText in C++, so they arrive trusted and they respect maxlength
function insertText(input: HTMLInputElement, text: string): boolean {
    try {
        input.setSelectionRange(0, input.value.length);
        document.execCommand("insertText", false, text);
    } catch {
        return false;
    }

    // The return value of execCommand is false outside a user gesture even when it worked
    return input.value.length > 0;
}

// React tracks the last value it wrote on the node itself, so assignment has to go around that property
function assign(input: HTMLInputElement, text: string): void {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new InputEvent("input", { ...bubbles, inputType: "insertText", data: text }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

// The wrapper Chrome's own autofill uses, because sites check that a keyboard interaction took place
export function fillField(input: HTMLInputElement, text: string): boolean {
    const refocus = document.activeElement !== input;
    if (refocus) input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", bubbles));

    if (!insertText(input, text)) assign(input, text);

    input.dispatchEvent(new KeyboardEvent("keyup", bubbles));
    if (refocus) input.blur();

    return input.value.includes(text.slice(0, input.maxLength > 0 ? input.maxLength : text.length));
}

/* Split groups */

// Costs no clipboard permission and touches nothing the user copied, unlike writing to the real clipboard
function synthesizePaste(input: HTMLInputElement, text: string): boolean {
    try {
        const data = new DataTransfer();
        data.setData("text/plain", text);
        input.focus();
        input.dispatchEvent(new ClipboardEvent("paste", { ...bubbles, cancelable: true, clipboardData: data }));
    } catch {
        return false;
    }
    return false;
}

function fillSplit(inputs: HTMLInputElement[], code: string): boolean {
    const first = inputs[0];
    if (!first) return false;

    // A dispatched paste inserts nothing by itself, so it only pays off where the widget handles it
    synthesizePaste(first, code);
    if (inputs.every((input, index) => input.value === code[index])) return true;

    inputs.forEach((input, index) => {
        const character = code[index];
        if (character !== undefined) fillField(input, character);
    });

    return inputs.every((input, index) => input.value === code[index]);
}

/* Entry point */

export function fillOtp(field: OtpField, code: string): boolean {
    return field.kind === "single" ? fillField(field.input, code) : fillSplit(field.inputs, code);
}
