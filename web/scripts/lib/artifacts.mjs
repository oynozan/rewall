// Screenshots are throwaway run output, so they go to the OS temp directory and never near the repo

import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ARTIFACTS = process.env.REWALL_ARTIFACTS || join(tmpdir(), "rewall-dashboard");

export async function artifacts() {
    await mkdir(ARTIFACTS, { recursive: true });
    return ARTIFACTS;
}
