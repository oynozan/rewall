// Finds the field a one time code goes into. Pure DOM, no extension APIs, so it runs anywhere a page does.

export type OtpField = { kind: "single"; input: HTMLInputElement } | { kind: "split"; inputs: HTMLInputElement[] };

/* Signals */

// Verbatim from Chromium's kOneTimePwdRe, whose word boundaries are why it beats a substring list
const OTP_RE =
    /one.?time|(?:\b|_)(?:otp|otc|totp|sms|2fa|mfa)(?:\b|_)|(?:otp|otc|totp|sms|2fa|mfa).?(?:code|token|input|val|pin|login|verif|pass|pwd|psw|auth|field)|(?:verif(?:y|ication)?|email|phone|text|login|input|txt|user).?(?:otp|otc|totp|sms|2fa|mfa)|sms.?otp|mfa.?otp|verif(?:y|ication)?.?code|(?:\b|_)vcode|(?:second|two|2).?factor|wfls-token|email_code/i;

// Chromium's card code pattern without its leading "verification", which is the strongest OTP token there is
const CARD_RE =
    /card.?identification|security.?code|card.?code|security.?value|security.?number|card.?pin|c-v-v|(?:cvn|cvv|cvc|csc|cvd|ccv)|\bcid\b|cccid/i;

// Chromium's ZIP pattern, which collides with a bare pin through pin.?code
const ZIP_RE = /(?<!\.)zip|postal|post.*code|pcode|pin.?code/i;

// Filling a one time code into one of these burns a recovery code the user cannot get back
const RECOVERY_RE = /backup|recovery|scratch/i;

const TYPES = new Set(["text", "number", "tel"]);

const ATTRIBUTES = ["id", "name", "placeholder", "aria-label", "title", "class"];

/* Shadow roots */

// Bitwarden and KeePassXC converged on this accessor, and closed roots are common on plain hosts
function shadowOf(element: Element): ShadowRoot | null {
    if (element.shadowRoot) return element.shadowRoot;
    try {
        const dom = (globalThis as { chrome?: { dom?: { openOrClosedShadowRoot?(e: Element): ShadowRoot | null } } })
            .chrome?.dom;
        if (dom?.openOrClosedShadowRoot) return dom.openOrClosedShadowRoot(element);
        return (element as { openOrClosedShadowRoot?: ShadowRoot | null }).openOrClosedShadowRoot ?? null;
    } catch {
        return null;
    }
}

function collectInputs(root: Document | ShadowRoot, found: HTMLInputElement[] = []): HTMLInputElement[] {
    for (const element of root.querySelectorAll("*")) {
        if (element instanceof HTMLInputElement) found.push(element);

        // Gated on a plausible host, because the cross boundary call on every node is the slow path
        if (element.shadowRoot || element.tagName.includes("-")) {
            const shadow = shadowOf(element);
            if (shadow) collectInputs(shadow, found);
        }
    }
    return found;
}

/* Vetoes */

function haystack(element: Element): string {
    const parts = ATTRIBUTES.map((name) => element.getAttribute(name) ?? "");
    const joined = parts.join(" ").toLowerCase();

    // Compared with separators stripped too, so otp-code and otp_code read the same as otpcode
    return `${joined} ${joined.replace(/[\s_-]/g, "")}`;
}

// Bounded at four levels, because a page wide container naming itself would match almost anything
function ancestorText(input: HTMLInputElement): string {
    const seen: string[] = [];
    let node: Element | null = input.parentElement;

    for (let depth = 0; node && depth < 4; depth++) {
        seen.push(haystack(node));
        if (node === input.form) break;
        node = node.parentElement;
    }
    if (input.form && !seen.length) seen.push(haystack(input.form));

    return seen.join(" ");
}

function declaredOtp(input: HTMLInputElement): boolean {
    return (input.getAttribute("autocomplete") ?? "").split(/\s+/).includes("one-time-code");
}

function visible(input: HTMLInputElement): boolean {
    const rect = input.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

export function vetoed(input: HTMLInputElement): boolean {
    if (input.disabled || input.readOnly) return true;
    if ((input.getAttribute("placeholder") ?? "").includes("://")) return true;

    const max = input.maxLength;
    if (max > 20 || (max > 1 && max < 5)) return true;

    const text = haystack(input);
    if (RECOVERY_RE.test(text) || CARD_RE.test(text) || ZIP_RE.test(text)) return true;

    // A card form settles the security code collision, which sits in both the OTP and the card lists
    if (input.form?.querySelector('[autocomplete*="cc-number"], [autocomplete*="cc-csc"]')) return true;

    // input-otp paints its one real input invisible, so a declared field is trusted over its box
    return !declaredOtp(input) && !visible(input);
}

/* Split groups */

// Proton Pass matches siblings geometrically, which needs no class names and no per site list
function sameRow(a: HTMLInputElement, b: HTMLInputElement): boolean {
    const first = a.getBoundingClientRect();
    const second = b.getBoundingClientRect();
    if (second.width === 0 || second.width >= 100) return false;
    if (Math.abs(first.top - second.top) > 2 || Math.abs(first.bottom - second.bottom) > 2) return false;
    return Math.abs(first.width * first.height - second.width * second.height) <= 16;
}

function singleCharacter(input: HTMLInputElement): boolean {
    return TYPES.has(input.type) && (input.maxLength === 1 || input.maxLength === -1);
}

function splitGroup(candidates: HTMLInputElement[], input: HTMLInputElement): HTMLInputElement[] | null {
    if (!singleCharacter(input) || input.getBoundingClientRect().width >= 100) return null;

    const group = candidates.filter(
        (other) => other === input || (singleCharacter(other) && sameRow(input, other) && other.form === input.form),
    );
    return group.length >= 4 && group.length <= 8 ? group : null;
}

/* Detection */

export function detectOtpField(root: Document | ShadowRoot): OtpField | null {
    const candidates = collectInputs(root).filter((input) => !vetoed(input));

    // A declared field wins outright, and on input-otp style widgets it is the only real input present
    const declared = candidates.find(declaredOtp);
    if (declared) {
        const group = splitGroup(candidates, declared);
        return group ? { kind: "split", inputs: group } : { kind: "single", input: declared };
    }

    const named = candidates.filter(
        (input) => TYPES.has(input.type) && OTP_RE.test(`${input.name} ${input.id}`.toLowerCase()),
    );

    for (const input of named) {
        const group = splitGroup(candidates, input);
        if (group) return { kind: "split", inputs: group };
    }
    if (named[0]) return { kind: "single", input: named[0] };

    // A bare group of single character boxes, which carry no wording themselves so an ancestor has to supply it
    for (const input of candidates) {
        const group = splitGroup(candidates, input);
        if (group && OTP_RE.test(ancestorText(group[0]!))) return { kind: "split", inputs: group };
    }

    return null;
}
