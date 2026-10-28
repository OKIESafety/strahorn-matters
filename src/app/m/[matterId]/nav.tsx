"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav({ base, isOwner }: { base: string; isOwner: boolean }) {
  const path = usePathname();
  const items = [
    { href: base, label: "Timeline", exact: true },
    { href: `${base}/issues`, label: "Issues" },
    { href: `${base}/evidence`, label: "Evidence" },
    { href: `${base}/report`, label: "Report" },
    { href: `${base}/settings`, label: isOwner ? "Settings" : "Account" },
  ];
  return (
    <nav className="nav">
      {items.map((i) => {
        const active = i.exact ? path === i.href || path.startsWith(`${base}/e/`) : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={active ? "active" : ""}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
