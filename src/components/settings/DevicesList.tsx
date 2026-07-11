"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { revokePairCode, type ActivePair } from "@/lib/device-pair-actions";

export function DevicesList({ initial }: { initial: ActivePair[] }) {
  const [pairs, setPairs] = useState<ActivePair[]>(initial);
  const [pending, startTransition] = useTransition();

  function onRevoke(code: string) {
    startTransition(async () => {
      const res = await revokePairCode(code);
      if (!res.ok) { toast.error(res.error); return; }
      setPairs((prev) => prev.filter((p) => p.code !== code));
      toast.success(`Revoked ${code}`);
    });
  }

  if (pairs.length === 0) {
    return (
      <div className="mt-6 border border-border rounded-md p-6 text-sm text-muted-foreground">
        No active pair codes. Mint one from the operator console (Sync devices button) to network a projector on another device.
      </div>
    );
  }

  return (
    <div className="mt-6 border border-border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2">Code</th>
            <th className="text-left px-3 py-2">Label</th>
            <th className="text-left px-3 py-2">Kind</th>
            <th className="text-left px-3 py-2">Expires</th>
            <th className="text-right px-3 py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => (
            <tr key={p.code} className="border-t border-border">
              <td className="px-3 py-2 font-mono">{p.code}</td>
              <td className="px-3 py-2 text-muted-foreground">{p.label || <span className="italic opacity-60">—</span>}</td>
              <td className="px-3 py-2 text-muted-foreground">{p.kind}</td>
              <td className="px-3 py-2 text-muted-foreground">{new Date(p.expiresAt).toLocaleString()}</td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onRevoke(p.code)}
                  disabled={pending}
                  className="text-[11px] uppercase tracking-widest px-2 py-1 rounded border border-red-400/40 text-red-400 hover:border-red-300 disabled:opacity-50"
                >Revoke</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
