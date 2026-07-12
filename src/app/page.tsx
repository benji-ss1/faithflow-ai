import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";

export default async function Home() {
  const h = await headers();
  const c = await cookies();
  const isDesktop = h.get("x-pf-shell") === "desktop" || c.get("pf_shell")?.value === "desktop";
  redirect(isDesktop ? "/operator" : "/dashboard");
}
