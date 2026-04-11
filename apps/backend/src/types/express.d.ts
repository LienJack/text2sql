declare namespace Express {
  interface Request {
    requestId: string;
    actor: {
      id: string;
      role: "admin" | "user";
    };
  }
}
