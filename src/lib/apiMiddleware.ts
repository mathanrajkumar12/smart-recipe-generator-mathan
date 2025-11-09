import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../pages/api/auth/[...nextauth]";

/**
 * Universal middleware to enforce allowed methods and inject session.
 * Ensures each handler receives the logged-in user's session as the 3rd parameter.
 */
export const apiMiddleware = (methods: string[], handler: Function) => {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      // ✅ Allow only specific HTTP methods
      if (!methods.includes(req.method!)) {
        return res.status(405).json({ error: "Method not allowed" });
      }

      // ✅ Retrieve NextAuth session
      const session = await getServerSession(req, res, authOptions);

      if (!session) {
        return res.status(401).json({ error: "Unauthorized – please sign in" });
      }

      // ✅ Inject session into your handler (req, res, session)
      return handler(req, res, session);
    } catch (error) {
      console.error("Middleware error:", error);
      res.status(500).json({ error: "Internal server error in middleware" });
    }
  };
};
