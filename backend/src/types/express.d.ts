import type { UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      auth?: {
        userId: string;
        username: string;
        role: UserRole;
        sessionId: string;
        mustChangePassword: boolean;
        mfaEnabled: boolean;
        mfaVerified: boolean;
        adminStepUpVerifiedAt: Date | null;
        mustEnrollMfa: boolean;
        venueId: string | null;
        venueIds?: string[];
      };
    }
  }
}

export {};
