import type { Metadata } from "next";
import { SYNTHETIC_BANNER } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: "Patient Operations Record | Synthetic replay",
  description: "A source-linked inpatient operations replay with human-reviewed proposals. Synthetic data only.",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><div className="synthetic-banner">{SYNTHETIC_BANNER}</div>{children}</body></html>;
}
