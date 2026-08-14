import type { NextFunction, Request, RequestHandler, Response } from "express";
import { runWithRlsContext, type RlsSecurityContext } from "../config/prisma.js";

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

type AsyncHandlerOptions = {
  unauthenticatedActorRole?: Extract<RlsSecurityContext["actorRole"], "auth" | "public">;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const deriveRlsContext = (
  req: Request,
  options: AsyncHandlerOptions = {}
): RlsSecurityContext => {
  const actorRole = req.auth
    ? req.auth.role === "ADMIN"
      ? "admin"
      : req.auth.role === "SALON_YETKILISI"
        ? "operations"
        : req.auth.role === "MONTAJCI"
          ? "montage"
          : "customer"
    : (options.unauthenticatedActorRole ?? (req.baseUrl.includes("/auth") ? "auth" : "public"));
  const routeApplicationId = /\/booking-applications\/([0-9a-f-]{36})(?:\/|\?|$)/i.exec(
    req.originalUrl
  )?.[1];
  const idempotencyKey = req.get("Idempotency-Key");
  return {
    actorRole,
    actorUserId: req.auth?.userId,
    venueId: req.auth?.venueId ?? undefined,
    purpose: `http.${actorRole}`,
    resourceId: idempotencyKey && UUID_PATTERN.test(idempotencyKey) ? idempotencyKey : undefined,
    applicationId:
      routeApplicationId && UUID_PATTERN.test(routeApplicationId) ? routeApplicationId : undefined
  };
};

export const asyncHandler =
  (handler: AsyncRequestHandler, options: AsyncHandlerOptions = {}): RequestHandler =>
  (req, res, next) => {
    let deferredNextCalled = false;
    let deferredError: unknown;
    const deferredNext: NextFunction = (error?: unknown) => {
      deferredNextCalled = true;
      deferredError = error;
    };

    void runWithRlsContext(deriveRlsContext(req, options), () => handler(req, res, deferredNext))
      .then(() => {
        if (deferredNextCalled) next(deferredError);
      })
      .catch(next);
  };
