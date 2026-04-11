import type { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

export const requestActorMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const roleHeader = req.headers["x-user-role"]?.toString().toLowerCase();
  const role = roleHeader === "admin" ? "admin" : "user";
  const id = req.headers["x-user-id"]?.toString().trim() || `anonymous-${uuidv4()}`;
  req.actor = {
    id,
    role
  };
  next();
};
