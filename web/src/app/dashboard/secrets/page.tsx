import type { Metadata } from "next";
import { Suspense } from "react";
import { SecretsPage } from "@/src/components/dashboard/secrets-table";

export const metadata: Metadata = { title: "Secrets" };

export default function Page() {
    return (
        <Suspense>
            <SecretsPage />
        </Suspense>
    );
}
