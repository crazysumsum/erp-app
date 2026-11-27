import { storedUnits } from "./arCommand.js";
import { arError } from "./arErrors.js";

/** Allocate the rounded invoice total to its immutable lines in currency units. */
export function invoiceLineCreditLimits(lines, total, decimalPlaces) {
  const step = 10n ** BigInt(4 - decimalPlaces);
  const ranked = lines.map((line) => {
    const units = storedUnits(line.line_amount), remainder = units % step;
    return { id: Number(line.id), lineNo: Number(line.line_no), floor: units - remainder, remainder };
  });
  const left = total - ranked.reduce((sum, row) => sum + row.floor, 0n);
  const canRoundUp = ranked.filter((row) => row.remainder > 0n).length;
  if (left < 0n || left % step !== 0n || left / step > BigInt(canRoundUp)) throw arError("AR_CREDIT_SOURCE_INVALID");

  ranked.sort((a, b) => a.remainder === b.remainder ? a.lineNo - b.lineNo : a.remainder > b.remainder ? -1 : 1);
  return new Map(ranked.map((row, index) => [row.id, row.floor + (BigInt(index) < left / step ? step : 0n)]));
}
