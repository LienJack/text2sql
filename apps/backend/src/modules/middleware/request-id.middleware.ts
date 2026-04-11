import type { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  req.requestId = req.headers["x-request-id"]?.toString() ?? uuidv4();
  res.setHeader("x-request-id", req.requestId);
  next();
};

