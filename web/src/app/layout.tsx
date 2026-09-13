import type { Metadata } from "next";
import { Akt, Manrope, Lexend_Deca, Ubuntu_Mono } from "next/font/google";
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
    weight: ["200", "300", "400", "500"],
    subsets: ["latin"],
});

const akt = Akt({
    variable: "--font-akt",
    weight: ["400", "500"],
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: { default: "Rewall — Your private space", template: "%s · Rewall" },
    description: "A quiet home for your private credentials. Encrypted secrets, owned by your ENS name.",
    icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
    return (
        <html
            lang="en"
            className={`${manrope.variable} ${ubuntuMono.variable} ${lexendDeca.variable} ${akt.variable} h-full antialiased`}
        >
            <body>{children}</body>
        </html>
    );
}
