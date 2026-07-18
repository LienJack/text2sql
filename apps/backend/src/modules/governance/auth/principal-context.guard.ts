import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import { AppConfigService } from "../../config/app-config.service";

@Injectable()
export class PrincipalContextGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Express.Request>();
    const principal = request.actor?.principal;
    if (!principal) {
      throw new DomainError(
        "PRINCIPAL_CONTEXT_REQUIRED",
        "缺少已解析的 Principal 上下文。",
        401
      );
    }
    if (this.config.nodeEnv === "production" && principal.trustLevel !== "verified") {
      throw new DomainError(
        "TRUSTED_PRINCIPAL_REQUIRED",
        "生产请求必须来自已验证的 OIDC Principal。",
        401
      );
    }
    return true;
  }
}
