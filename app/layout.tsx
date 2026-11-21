import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "VIBE — Watch Together", description: "A better place to watch YouTube together." };
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}