import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseUnits,
  zeroAddress,
  type Address,
} from "viem";
import { getContract, type Deployment } from "./config";

// Protocol interfaces only. Deployed NOOP ABIs are fetched from the runtime manifest.
export const poolKeyType =
  "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)";
export const quoterAbi = parseAbi([
  `function quoteExactInputSingle((${poolKeyType} poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)`,
]);
export const routerAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
  "error ExecutionFailed(uint256 commandIndex, bytes message)",
  "error V4TooLittleReceived(uint256 minAmountOutReceived, uint256 amountReceived)",
]);
export const permitAbi = parseAbi([
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);
export const stateAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);
export function poolKey(config: Deployment) {
  const token = getContract(config, config.manifest.token.contract).address;
  const pair = config.manifest.pool.pairedCurrency;
  const [currency0, currency1] = [pair, token].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  ) as [Address, Address];
  return {
    currency0,
    currency1,
    fee: config.manifest.pool.fee,
    tickSpacing: config.manifest.pool.tickSpacing,
    hooks: getContract(config, config.manifest.hook.contract).address,
  };
}
export const poolId = (config: Deployment) =>
  keccak256(
    encodeAbiParameters(parseAbiParameters(poolKeyType), [poolKey(config)]),
  );
export function positiveAmount(value: string, decimals: number) {
  if (
    !/^\d+(\.\d*)?$/.test(value) ||
    (value.split(".")[1]?.length ?? 0) > decimals
  )
    throw Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  const amount = parseUnits(value, decimals);
  if (amount <= 0n || amount > 2n ** 128n - 1n)
    throw Error("Enter an amount greater than zero and below the swap limit.");
  return amount;
}
export function slippageBps(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw Error(
      "Use a slippage percentage from 0.01 to 5, with up to 2 decimals.",
    );
  const bps = Math.round(Number(value) * 100);
  if (bps < 1 || bps > 500)
    throw Error("Slippage must be between 0.01% and 5%.");
  return bps;
}
export const minimumOutput = (quoted: bigint, bps: number) =>
  (quoted * BigInt(10000 - bps)) / 10000n;
export function currencies(config: Deployment, buy: boolean) {
  const token = getContract(config, config.manifest.token.contract).address;
  return {
    input: buy ? config.manifest.pool.pairedCurrency : token,
    output: buy ? token : config.manifest.pool.pairedCurrency,
  };
}
export function swapCall(
  config: Deployment,
  buy: boolean,
  amount: bigint,
  minimum: bigint,
  deadline: bigint,
) {
  const key = poolKey(config);
  const { input, output } = currencies(config, buy);
  const params = [
    encodeAbiParameters(
      parseAbiParameters(
        `(${poolKeyType} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)`,
      ),
      [
        {
          poolKey: key,
          zeroForOne: input.toLowerCase() === key.currency0.toLowerCase(),
          amountIn: amount,
          amountOutMinimum: minimum,
          hookData: "0x",
        },
      ],
    ),
    encodeAbiParameters(
      parseAbiParameters("address currency, uint256 amount"),
      [input, amount],
    ),
    encodeAbiParameters(
      parseAbiParameters("address currency, uint256 amount"),
      [output, minimum],
    ),
  ];
  return {
    address: config.network.uniswapV4.universalRouter,
    abi: routerAbi,
    functionName: "execute" as const,
    args: [
      "0x10",
      [
        encodeAbiParameters(
          parseAbiParameters("bytes actions, bytes[] params"),
          ["0x060c0f", params],
        ),
      ],
      deadline,
    ] as const,
    value: input === zeroAddress ? amount : 0n,
  };
}
