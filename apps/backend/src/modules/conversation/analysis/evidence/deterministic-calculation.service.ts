import { Injectable } from "@nestjs/common";
import type {
  AnalysisCalculationContractV1,
  AnalysisCalculationV1
} from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import { sha256Digest, stableJson } from "../../../platform/data/persistence/analysis-ledger.util";

type Decimal = { integer: bigint; scale: number };

@Injectable()
export class DeterministicCalculationService {
  execute(contract: AnalysisCalculationContractV1): AnalysisCalculationV1 {
    this.validateContract(contract);
    const inputs = contract.inputs.map((input) =>
      input.value === null
        ? contract.nullPolicy === "zero"
          ? parseDecimal("0")
          : this.nullRejected(input.name)
        : parseDecimal(input.value)
    );
    const integer = this.calculate(contract, inputs);
    const value = formatDecimal(integer, contract.precision);
    const inputDigest = sha256Digest(stableJson(contract));
    const output = {
      value,
      ...(contract.outputUnit ? { unit: contract.outputUnit } : {})
    };
    return {
      version: "analysis-calculation.v1",
      contract,
      inputDigest,
      output,
      outputDigest: sha256Digest(stableJson({ inputDigest, output })),
      recomputable: true
    };
  }

  private validateContract(contract: AnalysisCalculationContractV1): void {
    if (
      contract.version !== "analysis-calculation-contract.v1" ||
      contract.operatorVersion !== "deterministic-decimal.v1" ||
      contract.rounding !== "half_up" ||
      !Number.isInteger(contract.precision) ||
      contract.precision < 0 ||
      contract.precision > 12
    ) {
      throw new DomainError(
        "ANALYSIS_CALCULATION_CONTRACT_INVALID",
        "Calculation contract version、rounding 或 precision 无效。",
        400
      );
    }
    const expected =
      contract.operator === "sum"
        ? { min: 1, max: Number.POSITIVE_INFINITY }
        : { min: 2, max: 2 };
    if (
      contract.inputs.length < expected.min ||
      contract.inputs.length > expected.max ||
      contract.inputs.some((input) => !input.name || !input.evidenceRef)
    ) {
      throw new DomainError(
        "ANALYSIS_CALCULATION_INPUT_INVALID",
        "Calculation inputs 数量或 evidence binding 无效。",
        400
      );
    }
  }

  private calculate(
    contract: AnalysisCalculationContractV1,
    values: Decimal[]
  ): bigint {
    if (contract.operator === "sum") {
      return roundDecimal(addDecimals(values), contract.precision);
    }
    const left = values[0];
    const right = values[1];
    if (contract.operator === "difference") {
      return roundDecimal(addDecimals([left, negate(right)]), contract.precision);
    }
    if (contract.operator === "ratio") {
      return divideDecimals(left, right, contract.precision);
    }
    if (contract.operator === "percent_change") {
      return divideDecimals(
        multiplyInteger(addDecimals([left, negate(right)]), 100n),
        absolute(right),
        contract.precision
      );
    }
    return divideDecimals(
      multiplyInteger(left, 100n),
      right,
      contract.precision
    );
  }

  private nullRejected(name: string): never {
    throw new DomainError(
      "ANALYSIS_CALCULATION_NULL_REJECTED",
      `Calculation input ${name} 为 null 且 nullPolicy=reject。`,
      409
    );
  }
}

function parseDecimal(value: string | number): Decimal {
  const normalized = String(value).trim();
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new DomainError(
      "ANALYSIS_CALCULATION_DECIMAL_INVALID",
      "Calculation 只接受有限十进制数值。",
      400
    );
  }
  const fraction = match[3] ?? "";
  if (fraction.length > 18 || (match[2]?.length ?? 0) > 36) {
    throw new DomainError(
      "ANALYSIS_CALCULATION_DECIMAL_LIMIT_EXCEEDED",
      "Calculation decimal 超出确定性精度上限。",
      400
    );
  }
  const sign = match[1] === "-" ? -1n : 1n;
  return {
    integer: sign * BigInt(`${match[2]}${fraction}`),
    scale: fraction.length
  };
}

function addDecimals(values: Decimal[]): Decimal {
  const scale = Math.max(...values.map((value) => value.scale));
  return {
    integer: values.reduce(
      (sum, value) =>
        sum + value.integer * power10(scale - value.scale),
      0n
    ),
    scale
  };
}

function negate(value: Decimal): Decimal {
  return { integer: -value.integer, scale: value.scale };
}

function absolute(value: Decimal): Decimal {
  return {
    integer: value.integer < 0n ? -value.integer : value.integer,
    scale: value.scale
  };
}

function multiplyInteger(value: Decimal, multiplier: bigint): Decimal {
  return { integer: value.integer * multiplier, scale: value.scale };
}

function divideDecimals(
  numerator: Decimal,
  denominator: Decimal,
  outputScale: number
): bigint {
  if (denominator.integer === 0n) {
    throw new DomainError(
      "ANALYSIS_CALCULATION_DIVISION_BY_ZERO",
      "Calculation denominator 不能为 0。",
      409
    );
  }
  const dividend =
    numerator.integer * power10(denominator.scale + outputScale);
  const divisor = denominator.integer * power10(numerator.scale);
  return divideHalfUp(dividend, divisor);
}

function roundDecimal(value: Decimal, outputScale: number): bigint {
  if (value.scale === outputScale) {
    return value.integer;
  }
  if (value.scale < outputScale) {
    return value.integer * power10(outputScale - value.scale);
  }
  return divideHalfUp(value.integer, power10(value.scale - outputScale));
}

function divideHalfUp(dividend: bigint, divisor: bigint): bigint {
  const negative = (dividend < 0n) !== (divisor < 0n);
  const absoluteDividend = dividend < 0n ? -dividend : dividend;
  const absoluteDivisor = divisor < 0n ? -divisor : divisor;
  const quotient = absoluteDividend / absoluteDivisor;
  const remainder = absoluteDividend % absoluteDivisor;
  const rounded = remainder * 2n >= absoluteDivisor ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function formatDecimal(integer: bigint, scale: number): string {
  const negative = integer < 0n;
  const absolute = (negative ? -integer : integer).toString().padStart(scale + 1, "0");
  if (scale === 0) {
    return `${negative ? "-" : ""}${absolute}`;
  }
  const whole = absolute.slice(0, -scale);
  const fraction = absolute.slice(-scale);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function power10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}
