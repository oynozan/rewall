import Link from "next/link";

export default function NotFound() {
    return (
        <main className="not-found">
            <h1>That page is not here</h1>
            <p>The link may be old, or the page may never have existed.</p>
            <div className="not-found-actions">
                <Link className="button" href="/">
                    Back to the start
                </Link>
                <Link className="button primary" href="/dashboard">
                    Open your vault
                </Link>
            </div>
        </main>
    );
}
