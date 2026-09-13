// rewall.site is unsigned, so a hostname that moved is confirmed rather than filled, per SPEC section 8

export type Sites = Record<string, string>;

// A first sighting has no prior to disagree with, so only a changed hostname is held back
export function splitMoved(sites: Sites, seen: Sites): { moved: Sites; settled: Sites } {
    const moved: Sites = {};
    const settled: Sites = {};

    for (const [secretName, hostname] of Object.entries(sites)) {
        if (seen[secretName] && seen[secretName] !== hostname) moved[secretName] = hostname;
        else settled[secretName] = hostname;
    }

    return { moved, settled };
}
