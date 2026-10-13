import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Desk — Bias Desk",
  description: "Phase 2 fundamental bias: rules-v1 + optional LLM overlay.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-200 antialiased">
        <header className="border-b border-slate-800">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-sm font-medium text-sky-400 hover:underline">
              ← Desk
            </Link>
            <nav className="flex gap-4 text-sm text-slate-400">
              <Link href="/" className="hover:text-white">Data health</Link>
              <Link href="/bias" className="hover:text-white">Bias desk</Link>
              <Link href="/pair/EURUSD" className="hover:text-white">Pair desk</Link>
              <Link href="/playbook" className="hover:text-white">Playbook</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
