// ── Clerk Webhook Handler ──
// Syncs Clerk user events → our Employee table.
// On user.created: links pre-provisioned Employee record.
// On user.updated: syncs verified email/name changes.
// On user.deleted: soft-deletes (sets INACTIVE).

import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";

interface WebhookEmailAddress {
  id: string;
  email_address: string;
  verification?: {
    status?: string;
  } | null;
}

/**
 * Strictly extracts the verified primary email address.
 * NEVER falls back to email_addresses[0].
 * Requires both ID match with primary_email_address_id and status === "verified".
 */
function getVerifiedPrimaryEmail(
  emailAddresses?: WebhookEmailAddress[] | null,
  primaryEmailId?: string | null
): string | null {
  if (!emailAddresses || !primaryEmailId) {
    return null;
  }
  const primaryEmail = emailAddresses.find((e) => e.id === primaryEmailId);
  if (!primaryEmail || primaryEmail.verification?.status !== "verified") {
    return null;
  }
  return primaryEmail.email_address?.trim() || null;
}

export async function POST(req: NextRequest) {
  let evt;
  try {
    evt = await verifyWebhook(req);
  } catch (err) {
    console.error("[Webhook] Verification failed:", err);
    return new Response("Webhook verification failed", { status: 400 });
  }

  const eventType = evt.type;

  // ── User Created → Link to existing Employee (invite-only) ──
  if (eventType === "user.created") {
    const { id, email_addresses, primary_email_address_id, first_name, last_name, image_url } = evt.data;

    // Strict verified primary email check: no fallback to email_addresses[0]
    const email = getVerifiedPrimaryEmail(
      email_addresses as WebhookEmailAddress[] | undefined,
      primary_email_address_id
    );

    if (!email) {
      console.warn(`[Webhook] Skipped user.created for ${id}: primary email is missing, unmatched, or unverified.`);
      return new Response("Primary email is missing or unverified", { status: 200 });
    }

    const name = `${first_name ?? ""}`.trim();
    const surname = `${last_name ?? ""}`.trim();

    try {
      // Only link if the employee was pre-provisioned (invited) via the dashboard.
      const existingEmployee = await db.employee.findUnique({ where: { email } });

      if (!existingEmployee) {
        // Not invited — do NOT auto-create. Signups are strictly invite-only.
        console.warn(`[Webhook] Skipped uninvited user ${email} (${id})`);
        return new Response("User not invited", { status: 200 });
      }

      // Account Linking Security Check:
      // Prevent silent reassignment / account takeover if employee is already bound to another Clerk ID.
      if (
        existingEmployee.clerkId &&
        existingEmployee.clerkId !== id &&
        !existingEmployee.clerkId.startsWith("pending_")
      ) {
        console.error(
          `[Webhook Security Alert] Prevented account takeover: Clerk ID ${id} attempted to claim employee ${email} already linked to ${existingEmployee.clerkId}`
        );
        return new Response("Account already linked to another identity", { status: 200 });
      }

      // Link Clerk ID to pre-provisioned employee record (or idempotent update if already linked)
      await db.employee.update({
        where: { email },
        data: {
          clerkId: id,
          ...(name && { firstName: name }),
          ...(surname && { lastName: surname }),
          avatarUrl: image_url ?? existingEmployee.avatarUrl,
        },
      });
      console.log(`[Webhook] Linked invited employee ${email} to Clerk ID ${id}`);
    } catch (err: unknown) {
      // Handle unique constraint or duplicate event gracefully
      if ((err as { code?: string }).code === "P2002") {
        console.log(`[Webhook] Employee already linked or duplicate event for ${id}, skipping (idempotent)`);
      } else {
        console.error(`[Webhook] Error in user.created for ${id}:`, err);
        return new Response("Internal error processing webhook", { status: 500 });
      }
    }
  }

  // ── User Updated → Sync Fields ──
  if (eventType === "user.updated") {
    const { id, email_addresses, primary_email_address_id, first_name, last_name, image_url } = evt.data;

    // Strict verified primary email check: no fallback to email_addresses[0]
    const verifiedEmail = getVerifiedPrimaryEmail(
      email_addresses as WebhookEmailAddress[] | undefined,
      primary_email_address_id
    );

    try {
      // 1. Update existing employee linked to this clerkId
      const updated = await db.employee.updateMany({
        where: { clerkId: id },
        data: {
          ...(verifiedEmail && { email: verifiedEmail }),
          ...(first_name !== undefined && { firstName: first_name ?? "" }),
          ...(last_name !== undefined && { lastName: last_name ?? "" }),
          ...(image_url !== undefined && { avatarUrl: image_url }),
        },
      });

      // 2. Late-linking flow: If user was not previously linked by clerkId (e.g. was unverified
      // during user.created, but just now verified their primary email).
      if (updated.count === 0 && verifiedEmail) {
        const existingEmployee = await db.employee.findUnique({ where: { email: verifiedEmail } });
        if (
          existingEmployee &&
          (!existingEmployee.clerkId || existingEmployee.clerkId.startsWith("pending_"))
        ) {
          await db.employee.update({
            where: { email: verifiedEmail },
            data: {
              clerkId: id,
              ...(first_name && { firstName: first_name }),
              ...(last_name && { lastName: last_name }),
              avatarUrl: image_url ?? existingEmployee.avatarUrl,
            },
          });
          console.log(`[Webhook] Linked invited employee on user.updated for ${verifiedEmail} (${id})`);
        } else if (
          existingEmployee &&
          existingEmployee.clerkId &&
          existingEmployee.clerkId !== id &&
          !existingEmployee.clerkId.startsWith("pending_")
        ) {
          console.error(
            `[Webhook Security Alert] Prevented late account takeover on user.updated: Clerk ID ${id} attempted to claim employee ${verifiedEmail} already linked to ${existingEmployee.clerkId}`
          );
        } else {
          console.log(`[Webhook] Skipped update for uninvited/unlinked user ${id}`);
        }
      } else {
        console.log(`[Webhook] Updated employee ${id}`);
      }
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "P2002") {
        console.warn(`[Webhook] Unique constraint violation (P2002) updating employee ${id} (e.g. email already exists):`, err);
      } else {
        console.warn(`[Webhook] Error updating employee ${id}:`, err);
      }
    }
  }

  // ── User Deleted → Soft Delete ──
  if (eventType === "user.deleted") {
    const { id } = evt.data;
    if (!id) {
      return new Response("Missing user id in user.deleted", { status: 400 });
    }

    try {
      await db.employee.updateMany({
        where: { clerkId: id },
        data: { status: "INACTIVE" },
      });
      console.log(`[Webhook] Deactivated employee ${id}`);
    } catch (err) {
      console.warn(`[Webhook] Error deactivating employee ${id}:`, err);
    }
  }

  return new Response("OK", { status: 200 });
}
