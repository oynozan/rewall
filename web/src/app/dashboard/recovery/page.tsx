import { Suspense } from "react";
import { RecoveryPage } from "@/src/components/dashboard/recovery";

export default function Page() {
    return (
        <Suspense>
            <RecoveryPage />
        </Suspense>
    );
}
