import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import type { ModelingGraphCalculatedField, ModelingGraphModel, ModelingGraphPayload } from "../../platform/data/persistence/modeling-graph.types";

type CalculatedFieldExpressionErrorCategory = "syntax" | "type" | "ref" | "not-supported";
type CalculatedFieldFunctionGroup = "aggregate" | "math" | "string";
type ExpressionValueType = "number" | "string" | "boolean" | "datetime" | "unknown";
type ExpressionTokenType =
  | "identifier"
  | "number"
  | "string"
  | "operator"
  | "lparen"
  | "rparen"
  | "comma";
type ExpressionToken = {
  type: ExpressionTokenType;
  value: string;
  position: number;
};
type ExpressionValidationContext = {
  currentModel: ModelingGraphModel;
  modelById: Map<string, ModelingGraphModel>;
  modelAliasToId: Map<string, string>;
  modelColumns: Map<string, Map<string, ExpressionValueType>>;
  calculatedFieldTypes: Map<string, Map<string, ExpressionValueType>>;
};

class ExpressionValidationError extends Error {
  constructor(
    public readonly category: CalculatedFieldExpressionErrorCategory,
    reason: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(reason);
  }
}

const SUPPORTED_FUNCTION_GROUPS: Record<CalculatedFieldFunctionGroup, string[]> = {
  aggregate: ["sum", "avg", "min", "max", "count"],
  math: ["abs", "round", "coalesce", "nullif"],
  string: ["lower", "upper", "length", "concat"]
};
const SUPPORTED_FUNCTIONS = new Set(
  Object.values(SUPPORTED_FUNCTION_GROUPS).flatMap((items) => items)
);
const UNSUPPORTED_KEYWORDS = /\b(select|from|where|join|case|when|then|else|end|over|partition|order|group|having|union|limit)\b/i;
const NOT_SUPPORTED_TOKENS = /(::|->|=>)/;

@Injectable()
export class WorkspaceCalculatedFieldExpressionValidatorService {
  validate(payload: ModelingGraphPayload): void {
    const context = this.buildContext(payload);
    for (const calculatedField of payload.calculatedFields) {
      this.validateCalculatedField(calculatedField, context);
    }
  }

  private validateCalculatedField(
    calculatedField: ModelingGraphCalculatedField,
    context: Omit<ExpressionValidationContext, "currentModel"> & {
      currentModel?: ModelingGraphModel;
    }
  ): void {
    const expression = calculatedField.expression.trim();
    if (!expression) {
      this.raiseDomainError(calculatedField, "syntax", "expression 不能为空。", {
        field: "expression"
      });
    }

    const currentModel = context.modelById.get(calculatedField.modelId);
    if (!currentModel) {
      this.raiseDomainError(
        calculatedField,
        "ref",
        "calculated field 引用了不存在的 model。",
        { reference: calculatedField.modelId }
      );
    }

    const scopedContext: ExpressionValidationContext = {
      currentModel,
      modelById: context.modelById,
      modelAliasToId: context.modelAliasToId,
      modelColumns: context.modelColumns,
      calculatedFieldTypes: context.calculatedFieldTypes
    };
    try {
      const inferredType = this.inferExpressionType(expression, scopedContext);
      const declaredType = this.normalizeScalarType(calculatedField.dataType);
      if (
        inferredType !== "unknown" &&
        declaredType !== "unknown" &&
        inferredType !== declaredType
      ) {
        throw new ExpressionValidationError("type", "expression 结果类型与 dataType 不一致。", {
          inferredType,
          declaredType
        });
      }
    } catch (error) {
      if (error instanceof ExpressionValidationError) {
        this.raiseDomainError(calculatedField, error.category, error.message, error.details);
      }
      throw error;
    }
  }

  private inferExpressionType(
    expression: string,
    context: ExpressionValidationContext
  ): ExpressionValueType {
    this.assertExpressionFeaturesSupported(expression);
    const tokens = this.tokenizeExpression(expression);
    if (tokens.length === 0) {
      throw new ExpressionValidationError("syntax", "expression 不能为空。", {
        field: "expression"
      });
    }

    let cursor = 0;
    const peek = (): ExpressionToken | undefined => tokens[cursor];
    const consume = (): ExpressionToken => {
      const token = tokens[cursor];
      if (!token) {
        throw new ExpressionValidationError("syntax", "expression 语法不完整。");
      }
      cursor += 1;
      return token;
    };
    const expect = (type: ExpressionTokenType, value?: string): ExpressionToken => {
      const token = consume();
      if (token.type !== type || (value !== undefined && token.value !== value)) {
        throw new ExpressionValidationError("syntax", "expression 语法错误。", {
          expected: value ?? type,
          actual: token.value,
          position: token.position
        });
      }
      return token;
    };
    const matchOperator = (operators: string[]): string | null => {
      const token = peek();
      if (!token || token.type !== "operator" || !operators.includes(token.value)) {
        return null;
      }
      consume();
      return token.value;
    };

    const parsePrimary = (): ExpressionValueType => {
      const token = peek();
      if (!token) {
        throw new ExpressionValidationError("syntax", "expression 语法不完整。");
      }
      if (token.type === "number") {
        consume();
        return "number";
      }
      if (token.type === "string") {
        consume();
        return "string";
      }
      if (token.type === "identifier") {
        const identifierToken = consume();
        if (peek()?.type === "lparen") {
          consume();
          const args: ExpressionValueType[] = [];
          if (peek()?.type !== "rparen") {
            args.push(parseExpression());
            while (peek()?.type === "comma") {
              consume();
              args.push(parseExpression());
            }
          }
          expect("rparen");
          return this.evaluateFunction(identifierToken, args);
        }
        return this.resolveReferenceType(identifierToken.value, context, identifierToken.position);
      }
      if (token.type === "lparen") {
        consume();
        const nested = parseExpression();
        expect("rparen");
        return nested;
      }
      throw new ExpressionValidationError("syntax", "expression 语法错误。", {
        token: token.value,
        position: token.position
      });
    };

    const parseUnary = (): ExpressionValueType => {
      const op = matchOperator(["+", "-"]);
      if (!op) {
        return parsePrimary();
      }
      const right = parseUnary();
      if (right === "unknown" || right === "number") {
        return right;
      }
      throw new ExpressionValidationError("type", "一元运算仅支持数字类型。", {
        operator: op
      });
    };

    const parseTerm = (): ExpressionValueType => {
      let left = parseUnary();
      while (true) {
        const op = matchOperator(["*", "/", "%"]);
        if (!op) {
          return left;
        }
        const right = parseUnary();
        left = this.evaluateBinaryOperator(op, left, right);
      }
    };

    const parseExpression = (): ExpressionValueType => {
      let left = parseTerm();
      while (true) {
        const op = matchOperator(["+", "-"]);
        if (!op) {
          return left;
        }
        const right = parseTerm();
        left = this.evaluateBinaryOperator(op, left, right);
      }
    };

    const inferredType = parseExpression();
    if (cursor < tokens.length) {
      const token = tokens[cursor]!;
      throw new ExpressionValidationError("syntax", "expression 语法错误。", {
        token: token.value,
        position: token.position
      });
    }
    return inferredType;
  }

  private buildContext(payload: ModelingGraphPayload): {
    modelById: Map<string, ModelingGraphModel>;
    modelAliasToId: Map<string, string>;
    modelColumns: Map<string, Map<string, ExpressionValueType>>;
    calculatedFieldTypes: Map<string, Map<string, ExpressionValueType>>;
  } {
    const modelById = new Map<string, ModelingGraphModel>();
    const modelAliasToId = new Map<string, string>();
    const modelColumns = new Map<string, Map<string, ExpressionValueType>>();
    const calculatedFieldTypes = new Map<string, Map<string, ExpressionValueType>>();

    for (const model of payload.models) {
      modelById.set(model.id, model);
      modelAliasToId.set(model.id.toLowerCase(), model.id);
      modelAliasToId.set(model.tableName.toLowerCase(), model.id);
      modelAliasToId.set(model.modelName.toLowerCase(), model.id);
      modelColumns.set(
        model.id,
        new Map(
          model.columns.map((column) => [column.name.toLowerCase(), this.normalizeScalarType(column.dataType)])
        )
      );
    }
    for (const calculatedField of payload.calculatedFields) {
      const scopedTypes = calculatedFieldTypes.get(calculatedField.modelId) ?? new Map<string, ExpressionValueType>();
      scopedTypes.set(calculatedField.name.toLowerCase(), this.normalizeScalarType(calculatedField.dataType));
      calculatedFieldTypes.set(calculatedField.modelId, scopedTypes);
    }
    return {
      modelById,
      modelAliasToId,
      modelColumns,
      calculatedFieldTypes
    };
  }

  private tokenizeExpression(expression: string): ExpressionToken[] {
    const tokens: ExpressionToken[] = [];
    let index = 0;
    while (index < expression.length) {
      const char = expression[index]!;
      if (/\s/.test(char)) {
        index += 1;
        continue;
      }
      if (char === "(") {
        tokens.push({ type: "lparen", value: "(", position: index });
        index += 1;
        continue;
      }
      if (char === ")") {
        tokens.push({ type: "rparen", value: ")", position: index });
        index += 1;
        continue;
      }
      if (char === ",") {
        tokens.push({ type: "comma", value: ",", position: index });
        index += 1;
        continue;
      }
      if (["+","-","*","/","%"].includes(char)) {
        tokens.push({ type: "operator", value: char, position: index });
        index += 1;
        continue;
      }
      if (char === "'" || char === "\"") {
        const quote = char;
        const start = index;
        index += 1;
        let closed = false;
        while (index < expression.length) {
          const current = expression[index]!;
          if (current === quote) {
            if (expression[index + 1] === quote) {
              index += 2;
              continue;
            }
            index += 1;
            closed = true;
            break;
          }
          index += 1;
        }
        if (!closed) {
          throw new ExpressionValidationError("syntax", "字符串字面量未闭合。", {
            position: start
          });
        }
        tokens.push({
          type: "string",
          value: expression.slice(start, index),
          position: start
        });
        continue;
      }
      if (/\d/.test(char)) {
        const start = index;
        index += 1;
        while (index < expression.length && /[\d.]/.test(expression[index]!)) {
          index += 1;
        }
        tokens.push({
          type: "number",
          value: expression.slice(start, index),
          position: start
        });
        continue;
      }
      if (/[A-Za-z_]/.test(char)) {
        const start = index;
        index += 1;
        while (index < expression.length && /[A-Za-z0-9_]/.test(expression[index]!)) {
          index += 1;
        }
        if (expression[index] === ".") {
          const dotIndex = index;
          index += 1;
          if (index >= expression.length || !/[A-Za-z_]/.test(expression[index]!)) {
            throw new ExpressionValidationError("syntax", "字段引用语法错误。", {
              position: dotIndex
            });
          }
          while (index < expression.length && /[A-Za-z0-9_]/.test(expression[index]!)) {
            index += 1;
          }
          if (expression[index] === ".") {
            throw new ExpressionValidationError("not-supported", "暂不支持多级字段引用。", {
              position: index
            });
          }
        }
        tokens.push({
          type: "identifier",
          value: expression.slice(start, index),
          position: start
        });
        continue;
      }
      if (/[<>=!&|?:`;$]/.test(char)) {
        throw new ExpressionValidationError("not-supported", "expression 包含暂不支持的语法。", {
          token: char,
          position: index
        });
      }
      throw new ExpressionValidationError("syntax", "expression 包含非法字符。", {
        token: char,
        position: index
      });
    }
    return tokens;
  }

  private evaluateBinaryOperator(
    operator: string,
    left: ExpressionValueType,
    right: ExpressionValueType
  ): ExpressionValueType {
    if ((left === "unknown" || left === "number") && (right === "unknown" || right === "number")) {
      return left === "unknown" || right === "unknown" ? "unknown" : "number";
    }
    throw new ExpressionValidationError("type", "算术运算仅支持数字类型。", {
      operator,
      leftType: left,
      rightType: right
    });
  }

  private evaluateFunction(token: ExpressionToken, args: ExpressionValueType[]): ExpressionValueType {
    const functionName = token.value.toLowerCase();
    if (!SUPPORTED_FUNCTIONS.has(functionName)) {
      throw new ExpressionValidationError("not-supported", `函数 ${functionName} 不在支持清单中。`, {
        functionName,
        supportedFunctionGroups: SUPPORTED_FUNCTION_GROUPS
      });
    }
    if (functionName === "sum" || functionName === "avg") {
      this.assertArgumentCount(functionName, args, [1], token.position);
      this.assertArgumentType(functionName, args[0]!, ["number", "unknown"], 0);
      return args[0] === "unknown" ? "unknown" : "number";
    }
    if (functionName === "count") {
      this.assertArgumentCount(functionName, args, [1], token.position);
      return "number";
    }
    if (functionName === "min" || functionName === "max") {
      this.assertArgumentCount(functionName, args, [1], token.position);
      return args[0] ?? "unknown";
    }
    if (functionName === "abs") {
      this.assertArgumentCount(functionName, args, [1], token.position);
      this.assertArgumentType(functionName, args[0]!, ["number", "unknown"], 0);
      return args[0] === "unknown" ? "unknown" : "number";
    }
    if (functionName === "round") {
      this.assertArgumentCount(functionName, args, [1, 2], token.position);
      this.assertArgumentType(functionName, args[0]!, ["number", "unknown"], 0);
      if (args[1] !== undefined) {
        this.assertArgumentType(functionName, args[1], ["number", "unknown"], 1);
      }
      return args.includes("unknown") ? "unknown" : "number";
    }
    if (functionName === "lower" || functionName === "upper" || functionName === "length") {
      this.assertArgumentCount(functionName, args, [1], token.position);
      this.assertArgumentType(functionName, args[0]!, ["string", "unknown"], 0);
      return functionName === "length" ? "number" : "string";
    }
    if (functionName === "concat") {
      this.assertArgumentCount(functionName, args, [1, 2, 3, 4, 5], token.position);
      return "string";
    }
    if (functionName === "nullif") {
      this.assertArgumentCount(functionName, args, [2], token.position);
      this.assertPairCompatible(functionName, args[0]!, args[1]!);
      return args[0] === "unknown" ? args[1]! : args[0]!;
    }
    if (functionName === "coalesce") {
      if (args.length === 0) {
        throw new ExpressionValidationError("syntax", "coalesce 至少需要一个参数。", {
          functionName
        });
      }
      return this.mergeCoalesceTypes(args, functionName);
    }
    return "unknown";
  }

  private resolveReferenceType(
    reference: string,
    context: ExpressionValidationContext,
    position: number
  ): ExpressionValueType {
    const normalized = reference.toLowerCase();
    const [left, right] = normalized.split(".");
    if (right) {
      const modelId = context.modelAliasToId.get(left);
      if (!modelId) {
        throw new ExpressionValidationError("ref", "expression 引用了不存在的 model。", {
          reference,
          position
        });
      }
      const modelColumns = context.modelColumns.get(modelId);
      const columnType = modelColumns?.get(right);
      if (columnType) {
        return columnType;
      }
      throw new ExpressionValidationError("ref", "expression 引用了不存在的字段。", {
        reference,
        position
      });
    }

    const currentColumns = context.modelColumns.get(context.currentModel.id);
    const columnType = currentColumns?.get(left);
    if (columnType) {
      return columnType;
    }
    const scopedCalculatedFields = context.calculatedFieldTypes.get(context.currentModel.id);
    const calculatedFieldType = scopedCalculatedFields?.get(left);
    if (calculatedFieldType) {
      return calculatedFieldType;
    }
    throw new ExpressionValidationError("ref", "expression 引用了不存在的字段。", {
      reference,
      position
    });
  }

  private normalizeScalarType(value: string): ExpressionValueType {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return "unknown";
    }
    if (
      normalized.includes("int") ||
      normalized.includes("decimal") ||
      normalized.includes("numeric") ||
      normalized.includes("double") ||
      normalized.includes("float") ||
      normalized === "number" ||
      normalized === "real"
    ) {
      return "number";
    }
    if (
      normalized.includes("char") ||
      normalized.includes("text") ||
      normalized.includes("string") ||
      normalized === "uuid"
    ) {
      return "string";
    }
    if (normalized === "bool" || normalized === "boolean") {
      return "boolean";
    }
    if (
      normalized.includes("date") ||
      normalized.includes("time")
    ) {
      return "datetime";
    }
    return "unknown";
  }

  private assertExpressionFeaturesSupported(expression: string): void {
    if (UNSUPPORTED_KEYWORDS.test(expression) || NOT_SUPPORTED_TOKENS.test(expression)) {
      throw new ExpressionValidationError("not-supported", "expression 包含暂不支持的语法特性。", {
        supportedFunctionGroups: SUPPORTED_FUNCTION_GROUPS
      });
    }
  }

  private assertArgumentCount(
    functionName: string,
    args: ExpressionValueType[],
    allowedCounts: number[],
    position: number
  ): void {
    if (allowedCounts.includes(args.length)) {
      return;
    }
    throw new ExpressionValidationError("syntax", `${functionName} 参数个数不正确。`, {
      functionName,
      expected: allowedCounts,
      actual: args.length,
      position
    });
  }

  private assertArgumentType(
    functionName: string,
    argumentType: ExpressionValueType,
    allowedTypes: ExpressionValueType[],
    index: number
  ): void {
    if (allowedTypes.includes(argumentType)) {
      return;
    }
    throw new ExpressionValidationError("type", `${functionName} 参数类型不正确。`, {
      functionName,
      argumentIndex: index,
      argumentType,
      allowedTypes
    });
  }

  private assertPairCompatible(
    functionName: string,
    left: ExpressionValueType,
    right: ExpressionValueType
  ): void {
    if (left === "unknown" || right === "unknown" || left === right) {
      return;
    }
    throw new ExpressionValidationError("type", `${functionName} 参数类型不兼容。`, {
      functionName,
      leftType: left,
      rightType: right
    });
  }

  private mergeCoalesceTypes(args: ExpressionValueType[], functionName: string): ExpressionValueType {
    let merged: ExpressionValueType = "unknown";
    for (const item of args) {
      if (item === "unknown") {
        continue;
      }
      if (merged === "unknown") {
        merged = item;
        continue;
      }
      if (merged !== item) {
        throw new ExpressionValidationError("type", `${functionName} 参数类型不兼容。`, {
          functionName,
          mergedType: merged,
          currentType: item
        });
      }
    }
    return merged;
  }

  private raiseDomainError(
    calculatedField: ModelingGraphCalculatedField,
    category: CalculatedFieldExpressionErrorCategory,
    reason: string,
    details?: Record<string, unknown>
  ): never {
    throw new DomainError(
      "WORKSPACE_MODELING_GRAPH_CALCULATED_FIELD_EXPRESSION_INVALID",
      `calculated field expression 非法：${reason}`,
      400,
      {
        field: "expression",
        category,
        calculatedFieldId: calculatedField.id,
        modelId: calculatedField.modelId,
        name: calculatedField.name,
        expression: calculatedField.expression,
        reason,
        ...details
      }
    );
  }
}
