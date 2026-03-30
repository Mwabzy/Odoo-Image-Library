import { cn } from "@/lib/utils/cn";

export function Separator({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-border/80", className)} />;
}
