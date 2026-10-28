import Link from "next/link";
import { requireMatter } from "@/lib/access";
import { Nav } from "./nav";

export default async function MatterLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const { matter, isOwner } = await requireMatter(matterId);
  const base = `/m/${matterId}`;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">
            <Link href={base}>{matter.title}</Link>
            <Link href="/?all=1" className="muted" style={{ fontSize: "0.85rem" }}>
              Matters
            </Link>
          </div>
          <Nav base={base} isOwner={isOwner} />
        </div>
      </header>
      <main className="container" style={{ paddingTop: 16 }}>
        {children}
      </main>
    </>
  );
}
