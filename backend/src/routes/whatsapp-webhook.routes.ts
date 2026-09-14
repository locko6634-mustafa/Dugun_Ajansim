import { Router } from "express";
import { env } from "../config/env.config.js";
import {
  recordWhatsAppDeliveryStatuses,
  verifyWhatsAppWebhookSignature
} from "../services/whatsapp-cloud.service.js";

const router = Router();
router.get("/", (req, res) => {
  if (
    env.WHATSAPP_MODE !== "cloud-api" ||
    req.query["hub.mode"] !== "subscribe" ||
    req.query["hub.verify_token"] !== env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  )
    return res.sendStatus(403);
  const challenge = req.query["hub.challenge"];
  if (typeof challenge !== "string" || challenge.length > 512) return res.sendStatus(400);
  res.type("text/plain").send(challenge);
});
router.post("/", async (req, res, next) => {
  try {
    if (
      env.WHATSAPP_MODE !== "cloud-api" ||
      !verifyWhatsAppWebhookSignature(req.rawBody, req.get("X-Hub-Signature-256"))
    )
      return res.sendStatus(403);
    await recordWhatsAppDeliveryStatuses(req.body);
    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
});
export default router;
