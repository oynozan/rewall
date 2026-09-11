// Markup shaped like the real login pages the detector has to survive, rendered by a real browser

const page = (body, head = "") => `<!doctype html><meta charset="utf-8"><style>
body { font: 14px system-ui; padding: 20px }
input { padding: 8px; font-size: 16px }
.box { width: 44px; text-align: center }
</style>${head}<body>${body}`;

export const fixtures = {
    // The one signal the HTML standard defines, and the only one that needs no guessing
    declared: {
        html: page(
            `<form><label>Code <input autocomplete="one-time-code" inputmode="numeric" maxlength="6"></label></form>`,
        ),
        expect: { kind: "single" },
    },

    // input-otp, the component behind shadcn, paints its single real input invisible and draws boxes over it
    inputOtp: {
        html: page(
            `<form><div style="position:relative">
                <input id="real" autocomplete="one-time-code" inputmode="numeric" maxlength="6"
                       style="position:absolute;inset:0;opacity:0;clip-path:inset(0 0 0 0);width:1px;height:1px">
                <div style="display:flex;gap:4px">
                    <div class="box">1</div><div class="box">2</div><div class="box">3</div>
                    <div class="box">4</div><div class="box">5</div><div class="box">6</div>
                </div>
            </div></form>`,
        ),
        expect: { kind: "single", id: "real" },
    },

    splitBoxes: {
        html: page(
            `<form id="otp-form"><div style="display:flex;gap:6px">
                ${[0, 1, 2, 3, 4, 5].map((i) => `<input class="box" id="d${i}" maxlength="1" inputmode="numeric">`).join("")}
            </div></form>`,
        ),
        expect: { kind: "split", count: 6 },
    },

    namedOnly: {
        html: page(`<form><input type="text" name="otp" maxlength="6"></form>`),
        expect: { kind: "single" },
    },

    verificationCode: {
        html: page(`<form><input type="text" id="verification_code"></form>`),
        expect: { kind: "single" },
    },

    // Sites reach for tel to get the numeric keypad, so excluding it would lose a real share of forms
    telInput: {
        html: page(`<form><input type="tel" name="mfa-code" maxlength="6"></form>`),
        expect: { kind: "single" },
    },

    shadowRoot: {
        html: page(
            `<div id="host"></div><script>
                const root = document.getElementById("host").attachShadow({ mode: "open" });
                root.innerHTML = '<input autocomplete="one-time-code" maxlength="6">';
            </script>`,
        ),
        expect: { kind: "single" },
    },

    /* Refusals */

    // security code sits in both the card list and the OTP list, and the card form is what settles it
    cardSecurityCode: {
        html: page(
            `<form>
                <input autocomplete="cc-number" name="cardnumber">
                <input type="text" name="securityCode" maxlength="4" placeholder="Security code">
            </form>`,
        ),
        expect: null,
    },

    zipCode: {
        html: page(`<form><input type="text" name="postal_code" maxlength="10"></form>`),
        expect: null,
    },

    backupCode: {
        html: page(`<form><input type="text" name="backup_code" maxlength="8"></form>`),
        expect: null,
    },

    recoveryCode: {
        html: page(`<form><input type="text" id="recovery-code" maxlength="10"></form>`),
        expect: null,
    },

    plainLogin: {
        html: page(`<form><input type="email" name="email"><input type="password" name="password"></form>`),
        expect: null,
    },

    // A short numeric field with no OTP wording at all, which is what a naive length check would grab
    quantity: {
        html: page(`<form><input type="number" name="quantity" maxlength="3"></form>`),
        expect: null,
    },

    disabledField: {
        html: page(`<form><input autocomplete="one-time-code" maxlength="6" disabled></form>`),
        expect: null,
    },
};
