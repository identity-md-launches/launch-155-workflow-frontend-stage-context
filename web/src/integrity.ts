import { keccak256, toBytes } from "viem";

// The handoff uses recursively sorted JSON object keys; array order is significant.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(obj[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const abiHash = (abi: unknown) =>
  keccak256(toBytes(canonical(abi))).slice(2);
