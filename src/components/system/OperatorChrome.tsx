"use client";
import { usePathname } from "next/navigation";
import { isOutputSurfacePath } from "@/lib/output-surfaces";

/**
 * Wraps anything that is for the OPERATOR only (update prompt, offline banner, toast area)
 * and renders nothing on the projector / stage / livestream / NDI pages — the congregation
 * must never see it. Fails toward hiding: on an output page nothing inside is even mounted,
 * so an update poller or a toast can't fire there either.
 */
export function OperatorChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isOutputSurfacePath(pathname)) return null;
  return <>{children}</>;
}
