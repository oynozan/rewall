import { Suspense } from "react";
import { TwoFactorPage } from "@/src/components/dashboard/two-factor";

export const metadata = { title: "2FA · Rewall" };

export default function Page() {
    return (
        <Suspense>
            <TwoFactorPage />
        </Suspense>
    );
}
