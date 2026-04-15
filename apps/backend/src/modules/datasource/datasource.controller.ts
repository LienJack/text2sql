import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { ApiResponse } from "@text2sql/shared-types";
import type { Request } from "express";
import { fail, ok } from "../../common/api-response";
import { DomainError } from "../../common/domain-error";
import { AppConfigService } from "../config/app-config.service";
import { CreateDatasourceDto } from "./dto/create-datasource.dto";
import { UploadFileDatasourceDto } from "./dto/upload-file-datasource.dto";
import { DatasourceService } from "./datasource.service";

type UploadedFilePayload = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@Controller("/api/v1")
export class DatasourceController {
  constructor(
    private readonly datasourceService: DatasourceService,
    private readonly appConfig: AppConfigService
  ) {}

  @Get("/datasources")
  async listDatasources(
    @Query("includeUnavailable") includeUnavailableRaw: string | undefined,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const includeUnavailable = includeUnavailableRaw !== "false";
      const datasources = await this.datasourceService.listDatasources({
        includeUnavailable
      });
      return ok(req.requestId, datasources);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post("/datasources")
  async createDatasource(
    @Body() body: CreateDatasourceDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const datasource = await this.datasourceService.createDatasource({
        name: body.name,
        type: body.type,
        host: body.host,
        port: body.port,
        database: body.database,
        username: body.username,
        password: body.password,
        filePath: body.filePath,
        shared: body.shared
      });
      return ok(req.requestId, datasource);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post("/datasources/upload")
  @UseInterceptors(FileInterceptor("file"))
  async uploadDatasourceFile(
    @UploadedFile() file: UploadedFilePayload | undefined,
    @Body() body: UploadFileDatasourceDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      if (!file) {
        throw new DomainError("VALIDATION_ERROR", "请上传 CSV 或 Excel 文件", 400);
      }
      if (file.size > this.appConfig.datasourceUploadMaxBytes) {
        throw new DomainError(
          "FILE_TOO_LARGE",
          `上传文件超过限制（${this.appConfig.datasourceUploadMaxBytes} bytes）`,
          400,
          {
            size: file.size
          }
        );
      }

      const savedPath = await this.persistUploadedFile(file);
      const datasource = await this.datasourceService.createDatasourceFromUpload({
        name: body.name,
        uploadedFile: {
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          path: savedPath
        }
      });
      return ok(req.requestId, datasource);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  private async persistUploadedFile(file: UploadedFilePayload): Promise<string> {
    const uploadDir = this.appConfig.datasourceUploadDir;
    await mkdir(uploadDir, { recursive: true });

    const ext = extname(file.originalname) || ".bin";
    const escapedExt = ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const baseName = file.originalname.replace(new RegExp(`${escapedExt}$`), "");
    const safeName = baseName
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 80);
    const storedName = `${Date.now()}-${uuidv4()}-${safeName || "upload"}${ext}`;
    const filePath = join(uploadDir, storedName);

    await writeFile(filePath, file.buffer);
    return filePath;
  }

  private toError(requestId: string, error: unknown): ApiResponse<never> {
    if (error instanceof DomainError) {
      return fail(requestId, error.code, error.message, error.details);
    }
    return fail(
      requestId,
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "未知错误"
    );
  }
}
