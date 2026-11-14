/**
 * Seed data for a fresh database. Idempotent â€” safe to run more than once
 * (existing rows are left untouched).
 *
 * Usage: npm run db:seed
 * Admin login: username "admin", password from SEED_ADMIN_PASSWORD
 * (default "Admin@123" â€” change it after first login).
 */
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as s from "../src/db/schema";

const ROLES = [
  { code: "ADMIN", name: "Admin" },
  { code: "GRN_ENTRY", name: "GRN Entry" },
  { code: "SALES", name: "Sales" },
  { code: "VIEWER", name: "Viewer" },
];

const CATEGORIES: { slot: number; label: string; mode: "MANDATORY" | "OPTIONAL" | "HIDDEN"; values: string[] }[] = [
  { slot: 1, label: "Style", mode: "OPTIONAL", values: ["Regular Fit", "Slim Fit", "Oversized", "Casual", "Formal"] },
  { slot: 2, label: "Color", mode: "MANDATORY", values: ["Black", "White", "Navy", "Grey", "Red", "Blue", "Beige"] },
  { slot: 3, label: "Size", mode: "MANDATORY", values: ["XS", "S", "M", "L", "XL", "XXL", "6", "7", "8", "9", "10", "Free"] },
  { slot: 4, label: "Type", mode: "OPTIONAL", values: ["Men", "Women", "Kids", "Unisex"] },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema: s });

  await db.transaction(async (tx) => {
    // Roles
    await tx.insert(s.roles).values(ROLES).onConflictDoNothing({ target: s.roles.code });
    const [adminRole] = await tx.select().from(s.roles).where(eq(s.roles.code, "ADMIN"));

    // Locations (both in Maharashtra â€” supplier 2 is in Gujarat so IGST can be tested)
    await tx
      .insert(s.locations)
      .values([
        { name: "Main Store", type: "STORE", stateCode: "27", gstin: "27AAAAA0000A1Z2", address: "Shop 1, MG Road, Pune 411001" },
        { name: "Central Godown", type: "GODOWN", stateCode: "27", gstin: "27AAAAA0000A1Z2", address: "Plot 12, Bhosari MIDC, Pune 411026" },
      ])
      .onConflictDoNothing({ target: s.locations.name });
    const allLocations = await tx.select().from(s.locations);

    // Admin user
    const password = process.env.SEED_ADMIN_PASSWORD || "Admin@123";
    const [admin] = await tx
      .insert(s.users)
      .values({ name: "Administrator", username: "admin", passwordHash: await bcrypt.hash(password, 12), roleId: adminRole.id })
      .onConflictDoNothing({ target: s.users.username })
      .returning();
    if (admin) {
      await tx.insert(s.userLocations).values(allLocations.map((l) => ({ userId: admin.id, locationId: l.id })));
      console.log(`Created admin user "admin" (password: ${process.env.SEED_ADMIN_PASSWORD ? "from SEED_ADMIN_PASSWORD" : "Admin@123"})`);
    }

    // Company profile + settings (single rows)
    await tx
      .insert(s.companyProfile)
      .values({ id: 1, name: "Your Company Pvt Ltd", address: "Shop 1, MG Road, Pune 411001", gstin: "27AAAAA0000A1Z2", stateCode: "27" })
      .onConflictDoNothing();
    await tx
      .insert(s.barcodeSettings)
      .values({ id: 1, prefix: "FD", suffix: "", digits: 6, startNumber: 1, labelSize: "50x25", labelFields: ["itemName", "mrp", "rsp", "cat2", "cat3", "barcodeText"], labelsPerRow: 2 })
      .onConflictDoNothing();
    await tx.insert(s.grnNumberSettings).values({ id: 1, prefix: "GRN", digits: 4 }).onConflictDoNothing();
    await tx.insert(s.salesSettings).values({ id: 1 }).onConflictDoNothing(); // migration 0008 also creates it with the defaults

    // Customers: the system Walk-in Customer (no credit, no advance) + one credit customer with an opening balance
    const [company] = await tx.select().from(s.companyProfile).where(eq(s.companyProfile.id, 1));
    const companyState = company?.stateCode ?? "27";
    const [walkin] = await tx.select({ id: s.customers.id }).from(s.customers).where(eq(s.customers.isWalkin, true));
    if (!walkin) {
      await tx.insert(s.customers).values({ name: "Walk-in Customer", phone: "0000000000", stateCode: companyState, openingDate: "2026-04-01", isWalkin: true });
      console.log('Created "Walk-in Customer"');
    }
    const existingCustomers = await tx.select({ n: sql<number>`count(*)::int` }).from(s.customers).where(eq(s.customers.isWalkin, false));
    if (existingCustomers[0].n === 0) {
      const [c] = await tx
        .insert(s.customers)
        .values({ name: "Sharma Garments", phone: "9822000003", gstin: "27AABCS1429B1ZU", stateCode: "27", address: "Laxmi Road, Pune", openingBalance: "20000.00", openingType: "DR", openingDate: "2026-04-01" })
        .onConflictDoNothing()
        .returning();
      if (c)
        await tx.insert(s.customerLedger).values({
          customerId: c.id,
          entryDate: c.openingDate,
          voucherType: "OPENING",
          voucherId: c.id,
          voucherNo: "OPENING",
          particulars: "Opening balance ₹20,000.00 Dr",
          debit: "20000.00",
          credit: "0",
        });
    }

    // Suppliers
    const existingSuppliers = await tx.select({ n: sql<number>`count(*)::int` }).from(s.suppliers);
    if (existingSuppliers[0].n === 0) {
      await tx.insert(s.suppliers).values([
        { name: "Shree Ganesh Textiles", gstin: "27AAPFU0939F1ZV", stateCode: "27", address: "Bhiwandi, Thane, Maharashtra", contactPerson: "Ramesh Patil", phone: "9820000001", pan: "AAPFU0939F", openingBalance: "0" },
        { name: "Surat Fashion House", gstin: "24AAACS1234A1Z8", stateCode: "24", address: "Ring Road, Surat, Gujarat", contactPerson: "Nilesh Shah", phone: "9825000002", pan: "AAACS1234A", openingBalance: "15000.00" },
      ]);
    }

    // Transport
    await tx.insert(s.transports).values([{ name: "VRL Logistics", phone: "1800000000" }, { name: "Self Pickup" }]).onConflictDoNothing({ target: s.transports.name });

    // Departments (apparel/footwear use the price-based slab: 5% up to â‚¹2,500, 18% above)
    await tx
      .insert(s.departments)
      .values([
        { name: "Apparel", hsnCode: "6205", gstRate: "5", slabEnabled: true, slabThreshold: "2500", slabRateAbove: "18" },
        { name: "Footwear", hsnCode: "6403", gstRate: "5", slabEnabled: true, slabThreshold: "2500", slabRateAbove: "18" },
        { name: "Bags & Accessories", hsnCode: "4202", gstRate: "18" },
      ])
      .onConflictDoNothing({ target: s.departments.name });

    // Categories
    for (const c of CATEGORIES) {
      await tx.insert(s.categoryConfig).values({ slot: c.slot, label: c.label, mode: c.mode }).onConflictDoNothing();
      await tx
        .insert(s.categoryValues)
        .values(c.values.map((value, i) => ({ slot: c.slot, value, sortOrder: i })))
        .onConflictDoNothing();
    }
  });

  console.log("Seed complete.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
