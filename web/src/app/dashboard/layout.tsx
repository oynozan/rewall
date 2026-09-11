import type { Metadata } from "next";
import { Providers } from "@/src/components/dashboard/providers";
import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import "./dashboard.css";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return (
        <Providers>
            <DashboardShell>{children}</DashboardShell>
        </Providers>
    );
}
