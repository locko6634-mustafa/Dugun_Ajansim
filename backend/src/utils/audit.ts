import { Prisma } from "@prisma/client";

type AuditWriter = Pick<Prisma.TransactionClient, "auditLog">;

export const writeAuditLog = async (
  client: AuditWriter,
  args: { data: Prisma.AuditLogCreateManyInput }
): Promise<void> => {
  const result = await client.auditLog.createMany(args);
  if (result.count !== 1) {
    throw new Error("Denetim kaydı oluşturulamadı.");
  }
};
