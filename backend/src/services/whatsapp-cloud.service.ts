import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type MessageKind } from "@prisma/client";
import { env } from "../config/env.config.js";
import { prisma } from "../config/prisma.js";
import { createPasswordSetupUrl, issuePasswordSetupToken } from "../utils/passwordSetup.js";
import {
  decryptBookingApplicationPii,
  decryptMessageTaskPii,
  decryptWeddingPii
} from "../utils/pii-crypto.js";

const automatedKinds = [
  "APPLICATION_APPROVED",
  "APPLICATION_REJECTED",
  "ACCOUNT_ACTIVATION"
] as const;
type AutomatedKind = (typeof automatedKinds)[number];

const isAutomatedKind = (kind: MessageKind): kind is AutomatedKind =>
  (automatedKinds as readonly string[]).includes(kind);

const templateNameFor = (kind: AutomatedKind): string => {
  if (kind === "APPLICATION_APPROVED") return env.WHATSAPP_TEMPLATE_APPLICATION_APPROVED;
  if (kind === "APPLICATION_REJECTED") return env.WHATSAPP_TEMPLATE_APPLICATION_REJECTED;
  return env.WHATSAPP_TEMPLATE_ACCOUNT_ACTIVATION;
};

const textParameter = (text: string): { type: "text"; text: string } => ({ type: "text", text });

const sendTemplate = async (
  to: string,
  templateName: string,
  parameters: Array<{ type: "text"; text: string }>
) => {
  const response = await fetch(
    `https://graph.facebook.com/${env.WHATSAPP_GRAPH_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "tr" },
          components: [{ type: "body", parameters }]
        }
      }),
      signal: AbortSignal.timeout(10_000)
    }
  );
  const body = (await response.json().catch(() => null)) as {
    messages?: Array<{ id?: string }>;
  } | null;
  const messageId = body?.messages?.[0]?.id;
  if (!response.ok || !messageId)
    throw new Error(`WhatsApp Cloud API isteği başarısız (${response.status}).`);
  return messageId;
};

export const verifyWhatsAppWebhookSignature = (
  rawBody: Buffer | undefined,
  signature: string | undefined
): boolean => {
  if (!rawBody || !signature?.startsWith("sha256=") || !env.WHATSAPP_APP_SECRET) return false;
  const expected = createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex");
  const received = signature.slice("sha256=".length);
  if (received.length !== expected.length || !/^[a-f0-9]+$/i.test(received)) return false;
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
};

export const processDueWhatsAppTasks = async (): Promise<{ sent: number; failed: number }> => {
  if (env.WHATSAPP_MODE !== "cloud-api") return { sent: 0, failed: 0 };
  const candidates = await prisma.messageTask.findMany({
    where: { status: "PLANNED", dueAt: { lte: new Date() }, kind: { in: [...automatedKinds] } },
    select: { id: true },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: 25
  });
  let sent = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const prepared = await prisma.$transaction(async (transaction) => {
      const task = await transaction.messageTask.findUnique({
        where: { id: candidate.id },
        include: { wedding: { include: { customerUser: true } }, application: true }
      });
      if (!task || task.status !== "PLANNED" || !isAutomatedKind(task.kind)) return null;
      const claimed = await transaction.messageTask.updateMany({
        where: { id: task.id, status: "PLANNED", updatedAt: task.updatedAt },
        data: {
          status: "PREPARED",
          preparedAt: new Date(),
          lastAttemptAt: new Date(),
          attemptCount: { increment: 1 }
        }
      });
      if (claimed.count !== 1) return null;
      const recipientPhone = decryptMessageTaskPii(task.id, task).recipientPhone.replace(/\D/g, "");
      const pii = task.wedding
        ? decryptWeddingPii(task.wedding.id, task.wedding)
        : decryptBookingApplicationPii(task.application!.id, task.application!);
      const couple = `${pii.brideFirstName} ${pii.brideLastName} ve ${pii.groomFirstName} ${pii.groomLastName}`;
      let parameters: Array<{ type: "text"; text: string }>;
      let preparedTokenId: string | null = null;
      if (task.kind === "ACCOUNT_ACTIVATION") {
        if (!task.wedding) throw new Error("Aktivasyon görevinin düğün kaydı bulunamadı.");
        const setup = await issuePasswordSetupToken(transaction, {
          userId: task.wedding.customerUser.id,
          purpose: "ACCOUNT_ACTIVATION",
          notBefore: task.wedding.customerUser.activeAt
        });
        preparedTokenId = setup.id;
        parameters = [
          textParameter(couple),
          textParameter(task.wedding.customerUser.username),
          textParameter(createPasswordSetupUrl(setup.token, "ACCOUNT_ACTIVATION"))
        ];
      } else {
        parameters = [textParameter(couple), textParameter(task.application!.referenceCode)];
      }
      await transaction.messageTask.update({ where: { id: task.id }, data: { preparedTokenId } });
      return {
        id: task.id,
        phone: recipientPhone,
        template: templateNameFor(task.kind),
        parameters
      };
    });
    if (!prepared) continue;
    try {
      const providerMessageId = await sendTemplate(
        prepared.phone,
        prepared.template,
        prepared.parameters
      );
      await prisma.messageTask.updateMany({
        where: { id: prepared.id, status: "PREPARED" },
        data: {
          status: "SENT",
          sentAt: new Date(),
          providerMessageId,
          providerStatus: "accepted",
          providerStatusAt: new Date()
        }
      });
      sent += 1;
    } catch {
      await prisma.messageTask.updateMany({
        where: { id: prepared.id, status: "PREPARED" },
        data: { status: "FAILED", failedAt: new Date(), failureReason: "provider_request_failed" }
      });
      failed += 1;
    }
  }
  return { sent, failed };
};

export const recordWhatsAppDeliveryStatuses = async (payload: unknown): Promise<void> => {
  type WebhookStatus = { id?: string; status?: string; timestamp?: string };
  type WebhookChange = { field?: string; value?: { statuses?: WebhookStatus[] } };
  type WebhookPayload = { entry?: Array<{ changes?: WebhookChange[] }> };
  const changes = (payload as WebhookPayload).entry ?? [];
  for (const entry of changes)
    for (const change of entry.changes ?? [])
      if (change.field === "messages")
        for (const status of change.value?.statuses ?? []) {
          if (!status.id || !status.status) continue;
          const at =
            status.timestamp && /^\d+$/.test(status.timestamp)
              ? new Date(Number(status.timestamp) * 1_000)
              : new Date();
          await prisma.messageTask.updateMany({
            where: {
              providerMessageId: status.id,
              OR: [{ providerStatusAt: null }, { providerStatusAt: { lte: at } }]
            },
            data: { providerStatus: status.status.slice(0, 64), providerStatusAt: at }
          });
        }
};
