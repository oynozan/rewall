// Reads a setup QR off a screenshot, in whichever context asked, so the same decoder serves the popup and the worker

import jsQR from "jsqr";

export type Rect = { x: number; y: number; width: number; height: number };

export class NoQrError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NoQrError";
    }
}

/* Pixels */

// createImageBitmap and OffscreenCanvas exist in a worker too, unlike Image and a document canvas
async function pixels(dataUrl: string, crop?: Rect): Promise<ImageData> {
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    } catch {
        throw new NoQrError("That screen could not be read.");
    }

    // Clamped, because a selection can start outside the page and end past its edge
    const area = crop
        ? {
              x: Math.max(0, Math.min(Math.round(crop.x), bitmap.width - 1)),
              y: Math.max(0, Math.min(Math.round(crop.y), bitmap.height - 1)),
              width: Math.round(crop.width),
              height: Math.round(crop.height),
          }
        : { x: 0, y: 0, width: bitmap.width, height: bitmap.height };

    area.width = Math.max(1, Math.min(area.width, bitmap.width - area.x));
    area.height = Math.max(1, Math.min(area.height, bitmap.height - area.y));

    const canvas = new OffscreenCanvas(area.width, area.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new NoQrError("That screen could not be read.");

    context.drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
    bitmap.close();
    return context.getImageData(0, 0, area.width, area.height);
}

/* Reading */

// Only a totp setup URI counts, so a QR holding a link or a wifi password is refused rather than stored as a seed
export function readOtpauth(text: string): string {
    const trimmed = text.trim();
    if (!/^otpauth:\/\/totp\//i.test(trimmed)) {
        throw new NoQrError("That code is not an authenticator setup code.");
    }
    return trimmed;
}

// Inverted first costs one extra pass and catches the dark mode QR codes several sites now render
export async function scanOtpauth(dataUrl: string, crop?: Rect): Promise<string> {
    const image = await pixels(dataUrl, crop);
    const found =
        jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" }) ??
        jsQR(image.data, image.width, image.height, { inversionAttempts: "invertFirst" });

    if (!found) throw new NoQrError("No setup code in what you selected. Try again around just the code.");
    return readOtpauth(found.data);
}
