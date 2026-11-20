"use client";

// ── Permission Gate Component ──
// Declarative way to show/hide UI based on permissions.
// Usage:
//   <PermissionGate permission="leave:approve">
//     <ApproveButton />
//   </PermissionGate>

import { useContext, type ReactNode } from "react";
import { PermissionContext } from "@/hooks/use-permission";
import type { Permission } from "@/lib/permissions";

interface PermissionGateProps {
  /** Single permission to check */
  permission?: Permission;
  /** Multiple permissions — user must have ANY of them */
  anyOf?: Permission[];
  /** What to show if the user lacks the permission */
  fallback?: ReactNode;
  children: ReactNode;
}

export function PermissionGate({ permission, anyOf, fallback = null, children }: PermissionGateProps) {
  // Always invoke hook unconditionally at the top level
  const permissions = useContext(PermissionContext);

  const hasSingle = permission ? permissions.has(permission) : true;
  const hasAny = anyOf && anyOf.length > 0 ? anyOf.some((p) => permissions.has(p)) : true;

  if (!hasSingle || !hasAny) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
