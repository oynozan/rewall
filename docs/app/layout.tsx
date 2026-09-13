import type { Metadata } from "next";
import { Lexend_Deca, Manrope, Ubuntu_Mono } from "next/font/google";
import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import "nextra-theme-docs/style.css";
import "./globals.css";

const manrope = Manrope({
    variable: "--font-manrope",
    subsets: ["latin"],
});

const ubuntuMono = Ubuntu_Mono({
    variable: "--font-ubuntu-mono",
    weight: ["400", "700"],
    subsets: ["latin"],
});

const lexendDeca = Lexend_Deca({
    variable: "--font-lexend-deca",
    weight: ["300", "400", "500"],
    subsets: ["latin"],
});

const REPO = "https://github.com/oynozan/rewall";

export const metadata: Metadata = {
    title: { default: "Rewall Docs", template: "%s · Rewall Docs" },
    description: "How Rewall stores, shares and revokes secrets under an ENS name.",
    icons: { icon: "/icon.svg" },
};

const navbar = (
    <Navbar logo={<img className="mark" src="/logo.svg" alt="Rewall" width={470} height={230} />} projectLink={REPO}>
        <a className="dash" href="https://rewall.me/dashboard">
            Dashboard
        </a>
    </Navbar>
);

const footer = (
    <Footer>
        <p className="foot">
            Permissionless secret infrastructure on ENSv2 Sepolia. Encrypted on your device, stored under your name,
            readable only by the keys you chose.
        </p>
    </Footer>
);

export default async function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html
            lang="en"
            dir="ltr"
            className={`${manrope.variable} ${ubuntuMono.variable} ${lexendDeca.variable}`}
            suppressHydrationWarning
        >
            <Head
                color={{ hue: 0, saturation: 0, lightness: 93 }}
                backgroundColor={{ dark: "#161616", light: "#161616" }}
            />
            <body>
                <Layout
                    navbar={navbar}
                    footer={footer}
                    pageMap={await getPageMap()}
                    docsRepositoryBase={`${REPO}/tree/main/docs`}
                    darkMode={false}
                    nextThemes={{ defaultTheme: "dark", forcedTheme: "dark" }}
                    sidebar={{ defaultMenuCollapseLevel: 1 }}
                >
                    {children}
                </Layout>
            </body>
        </html>
    );
}
