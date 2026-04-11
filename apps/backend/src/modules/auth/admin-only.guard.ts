import {
  CanActivate,
  ExecutionContext,
  Injectable
} from "@nestjs/common";
import { DomainError } from "../../common/domain-error";

@Injectable()
export class AdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      actor?: { role?: string };
      header?: (name: string) => string | undefined;
      headers?: Record<string, string | string[] | undefined>;
      rawHeaders?: string[];
    }>();
    const roleFromActor = request.actor?.role?.toLowerCase();
    const headerValue =
      request.header?.("x-user-role") ??
      request.headers?.["x-user-role"] ??
      request.headers?.["X-User-Role"];
    const roleFromHeader = (
      Array.isArray(headerValue) ? headerValue[0] : headerValue
    )?.toLowerCase();
    let roleFromRawHeaders: string | undefined;
    const rawHeaders = request.rawHeaders ?? [];
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (rawHeaders[index]?.toLowerCase() === "x-user-role") {
        roleFromRawHeaders = rawHeaders[index + 1]?.toLowerCase();
        break;
      }
    }
    if (
      roleFromActor === "admin" ||
      roleFromHeader === "admin" ||
      roleFromRawHeaders === "admin"
    ) {
      return true;
    }
    throw new DomainError("FORBIDDEN", "仅管理员可执行该操作。", 403);
  }
}
