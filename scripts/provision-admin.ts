// ── Provision Initial Admin Script ──
// Use this to bootstrap the first administrator account into Neon PostgreSQL.
// Run: npx tsx --env-file-if-exists=.env.local scripts/provision-admin.ts <email> [firstName] [lastName]

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "../lib/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Missing DATABASE_URL in environment");
}
const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const firstName = process.argv[3]?.trim() || "System";
  const lastName = process.argv[4]?.trim() || "Administrator";

  if (!email || !email.includes("@")) {
    console.error("Usage: npx tsx scripts/provision-admin.ts <email> [firstName] [lastName]");
    process.exit(1);
  }

  console.log(`Provisioning ADMIN employee profile for: ${email}`);

  const employee = await prisma.employee.upsert({
    where: { email },
    update: {
      role: "ADMIN",
      status: "ACTIVE",
      designation: "System Administrator"
    },
    create: {
      email,
      firstName,
      lastName,
      role: "ADMIN",
      status: "ACTIVE",
      designation: "System Administrator",
      clerkId: `pending_${Date.now()}`
    }
  });

  console.log(`✓ Admin employee created/updated successfully!`);
  console.log(`  ID: ${employee.id}`);
  console.log(`  Email: ${employee.email}`);
  console.log(`  Role: ${employee.role}`);
  console.log(`  Status: ${employee.status}`);
  console.log(`\nNext steps: Sign in via Clerk using ${email}. The app will link your Clerk account on first login.`);
}

main()
  .catch((err) => {
    console.error("Failed to provision admin:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

