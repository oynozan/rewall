/*
 * Shared plumbing for the Ledger Key Ring
 * The device is only ever needed to approve a member joining, so everything here splits into a
 * path that wants a session and a path that wants nothing but the member's own key
 */

import "reflect-metadata";
import { createRequire } from "node:module";
import { firstValueFrom, filter, timeout } from "rxjs";

// The ESM build resolves a directory Node refuses to import, so the CJS entry is the one that runs
const require = createRequire(import.meta.url);
const { DeviceManagementKitBuilder, DeviceActionStatus, DeviceModelId } = require("@ledgerhq/device-management-kit");
const { speculosTransportFactory } = require("@ledgerhq/device-transport-kit-speculos");
const {
    LedgerKeyringProtocolBuilder,
    NobleKeyPair,
    Permissions,
    Curve,
    LKRPEnv,
} = require("@ledgerhq/device-trusted-app-kit-ledger-keyring-protocol");

export { NobleKeyPair, Permissions, Curve };

// Ledger Live's own application id for the key ring, read off the wallet-cli build
const APPLICATION_ID = 17;

export const SPECULOS_URL = process.env.SPECULOS_URL || "http://127.0.0.1:5000";

// Staging, because production only trusts an attestation from a Ledger signed app and this one is
// compiled from source to run in the emulator
const ENV = LKRPEnv.STAGING;

/* With a device */

export async function withDevice() {
    const dmk = new DeviceManagementKitBuilder()
        .addTransport(speculosTransportFactory(SPECULOS_URL, false, DeviceModelId.NANO_SP))
        .build();

    const devices = await firstValueFrom(
        dmk.listenToAvailableDevices({}).pipe(
            filter((list: unknown[]) => list.length > 0),
            timeout(15000),
        ),
    );
    const sessionId = await dmk.connect({ device: devices[0] });
    const lkrp = new LedgerKeyringProtocolBuilder({ dmk, applicationId: APPLICATION_ID, env: ENV }).build();
    return { dmk, lkrp, sessionId };
}

/* Without one */

export function withoutDevice() {
    // No transport is registered, so there is no device this process could reach even if one existed
    const dmk = new DeviceManagementKitBuilder().build();
    return new LedgerKeyringProtocolBuilder({ dmk, applicationId: APPLICATION_ID, env: ENV }).build();
}

/* Approval */

const press = (what: string) =>
    fetch(`${SPECULOS_URL}/button/${what}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "press-and-release" }),
    }).catch(() => {});

const screenText = () =>
    fetch(`${SPECULOS_URL}/events?currentscreenonly=true`)
        .then((response) => response.json())
        .then((json) => (json.events ?? []).map((event: { text: string }) => event.text).join(" | "))
        .catch(() => "");

// The bare action is the choice, the question above it is only a prompt
const CONFIRM = /^(connect|approve|confirm|allow|turn on sync)$/i;

// Stands in for the human, which is the one thing an emulator cannot supply
async function confirmOnDevice(onApprove: (screen: string) => void) {
    for (let step = 0; step < 12; step++) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        const screen = (await screenText()).trim();
        if (CONFIRM.test(screen)) {
            onApprove(screen);
            await press("both");
            return;
        }
        await press("right");
    }
}

// Drives a device action to its result, answering every approval the device asks for along the way
export function run<T>(action: { observable: any }, onApprove: (screen: string) => void): Promise<T> {
    return new Promise((resolve, reject) => {
        let answering = false;
        action.observable.subscribe({
            next: async (state: any) => {
                if (state.status === DeviceActionStatus.Pending && !answering) {
                    answering = true;
                    await confirmOnDevice(onApprove);
                    answering = false;
                }
                if (state.status === DeviceActionStatus.Completed) resolve(state.output as T);
                if (state.status === DeviceActionStatus.Error) reject(state.error);
            },
            error: reject,
        });
    });
}
