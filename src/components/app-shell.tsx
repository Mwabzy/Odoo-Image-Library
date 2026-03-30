import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

export function AppShell({
  children,
  currentPath
}: {
  children: ReactNode;
  currentPath?: string;
}) {
  return (
    <div className="app-shell min-h-screen bg-[length:32px_32px] bg-[linear-gradient(rgba(26,58,53,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(26,58,53,0.08)_1px,transparent_1px)]">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-6 rounded-[2rem] border border-white/70 bg-white/80 px-6 py-5 shadow-soft backdrop-blur lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="w-fit">
              Product Image Automation
            </Badge>
            <div>
              <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
                Match, clean, and export product imagery without losing import
                structure.
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Deterministic matching first, review workflows when confidence
                drops, and Cloudinary-ready image outputs for ecommerce imports.
              </p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-3">
            <NavLink href="/dashboard" icon={Sparkles} currentPath={currentPath}>
              Dashboard
            </NavLink>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

function NavLink({
  href,
  currentPath,
  icon: Icon,
  children
}: {
  href: string;
  currentPath?: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  const active = currentPath === href;

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-white/75 text-foreground hover:bg-white"
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </Link>
  );
}
