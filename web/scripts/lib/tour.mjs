// The product tour covers the viewport with a click blocking overlay a moment after load, so a check
// that drives the dashboard has to arrive as someone who has already seen it

const STORAGE_KEY = "rewall:onboarding:v1";

export async function skipTour(page) {
    await page.addInitScript((key) => {
        try {
            localStorage.setItem(key, "done");
        } catch {}
    }, STORAGE_KEY);
}
