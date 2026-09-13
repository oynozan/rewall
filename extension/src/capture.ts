// The hostname a code is used at, taken from the tab rather than the frame that answers first

// Anything the browser will not let a content script touch cannot be a site a code is typed into
export function visitedHostname(url: string | undefined): string {
    if (!url) return "";
    try {
        const page = new URL(url);
        return page.protocol === "https:" || page.protocol === "http:" ? page.hostname : "";
    } catch {
        return "";
    }
}
