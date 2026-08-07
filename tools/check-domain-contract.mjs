import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_ORDER,
  MESSAGE_KIND_LABELS,
  ROLE_PANEL_CONFIG,
  STAFF_SPECIALTY_LABELS
} from "../js/shared/domain-labels.js";

const schemaPath = fileURLToPath(new URL("../backend/prisma/schema.prisma", import.meta.url));
const schema = await readFile(schemaPath, "utf8");

function readEnumValues(enumName) {
  const match = schema.match(new RegExp(`enum\\s+${enumName}\\s*\\{([^}]+)\\}`));
  if (!match) throw new Error(`Prisma enumu bulunamadı: ${enumName}`);
  return match[1]
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u)[0])
    .filter(Boolean);
}

function assertSameMembers(enumName, frontendValues) {
  const backendValues = readEnumValues(enumName);
  const sortedBackendValues = [...backendValues].sort();
  const sortedFrontendValues = [...frontendValues].sort();
  if (JSON.stringify(sortedBackendValues) !== JSON.stringify(sortedFrontendValues)) {
    throw new Error(
      `${enumName} sözleşmesi eşleşmiyor. Backend: ${backendValues.join(", ")} | Frontend: ${frontendValues.join(", ")}`
    );
  }
}

assertSameMembers("UserRole", Object.keys(ROLE_PANEL_CONFIG));
assertSameMembers("DeliveryStatus", Object.keys(DELIVERY_STATUS_LABELS));
assertSameMembers("MessageKind", Object.keys(MESSAGE_KIND_LABELS));
assertSameMembers("StaffSpecialty", Object.keys(STAFF_SPECIALTY_LABELS));

const deliveryStatuses = readEnumValues("DeliveryStatus");
if (JSON.stringify(deliveryStatuses) !== JSON.stringify(DELIVERY_STATUS_ORDER)) {
  throw new Error(
    `DeliveryStatus sırası eşleşmiyor. Backend: ${deliveryStatuses.join(", ")} | Frontend: ${DELIVERY_STATUS_ORDER.join(", ")}`
  );
}

console.log("Frontend alan etiketleri Prisma enumlarıyla eşleşiyor.");
