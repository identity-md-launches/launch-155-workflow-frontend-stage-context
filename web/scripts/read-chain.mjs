// Read-only worker evidence. Never uses a wallet, signer or eth_sendTransaction.
import { readFile, writeFile } from "node:fs/promises";
import {
  createPublicClient,
  http,
  parseAbi,
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
} from "viem";
const root = new URL("../../", import.meta.url);
const config = JSON.parse(
  await readFile(new URL("dist/imd-deployment.json", root), "utf8"),
);
const token = config.contracts.find(
  (c) => c.name === config.manifest.token.contract,
);
const hook = config.contracts.find(
  (c) => c.name === config.manifest.hook.contract,
);
const tokenAbi = JSON.parse(
  await readFile(new URL(`dist/${token.abiPath}`, root), "utf8"),
);
const hookAbi = JSON.parse(
  await readFile(new URL(`dist/${hook.abiPath}`, root), "utf8"),
);
const [currency0, currency1] = [
  config.manifest.pool.pairedCurrency,
  token.address,
].sort();
const poolKey = {
  currency0,
  currency1,
  fee: config.manifest.pool.fee,
  tickSpacing: config.manifest.pool.tickSpacing,
  hooks: hook.address,
};
const poolId = keccak256(
  encodeAbiParameters(
    parseAbiParameters(
      "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
    ),
    [poolKey],
  ),
);
const stateAbi = parseAbi([
  "function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)",
  "function getLiquidity(bytes32) view returns (uint128)",
]);
const evidence = {
  checkedAt: new Date().toISOString(),
  sourceCommit: config.sourceCommit,
  poolId,
  attempts: [],
  broadcastTransactions: 0,
};
for (const url of config.network.rpcUrls) {
  const client = createPublicClient({
    transport: http(url, { timeout: 10000, retryCount: 0 }),
  });
  try {
    const chainId = await client.getChainId();
    if (chainId !== config.chainId) throw Error(`Unexpected chain ${chainId}`);
    const blockNumber = await client.getBlockNumber();
    const code = await Promise.all(
      [
        ...config.contracts.map((c) => ({ name: c.name, address: c.address })),
        ...Object.entries(config.network.uniswapV4).map(([name, address]) => ({
          name,
          address,
        })),
      ].map(async (c) => ({
        ...c,
        bytes: ((await client.getCode({ address: c.address }))?.length - 2) / 2,
      })),
    );
    const [supply, decimals, manager, permissions, slot0, liquidity] =
      await Promise.all([
        client.readContract({
          address: token.address,
          abi: tokenAbi,
          functionName: "totalSupply",
          blockNumber,
        }),
        client.readContract({
          address: token.address,
          abi: tokenAbi,
          functionName: "decimals",
          blockNumber,
        }),
        client.readContract({
          address: hook.address,
          abi: hookAbi,
          functionName: "poolManager",
          blockNumber,
        }),
        client.readContract({
          address: hook.address,
          abi: hookAbi,
          functionName: "getHookPermissions",
          blockNumber,
        }),
        client.readContract({
          address: config.network.uniswapV4.stateView,
          abi: stateAbi,
          functionName: "getSlot0",
          args: [poolId],
          blockNumber,
        }),
        client.readContract({
          address: config.network.uniswapV4.stateView,
          abi: stateAbi,
          functionName: "getLiquidity",
          args: [poolId],
          blockNumber,
        }),
      ]);
    evidence.attempts.push({
      url,
      chainId,
      blockNumber,
      code,
      supply,
      decimals,
      manager,
      permissions,
      slot0,
      liquidity,
      result: "read-success",
    });
    break;
  } catch (error) {
    evidence.attempts.push({
      url,
      result: "unavailable",
      error: (error.shortMessage ?? error.message).slice(0, 500),
    });
  }
}
await writeFile(
  new URL("docs/frontend/live-chain.json", root),
  JSON.stringify(
    evidence,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    evidence,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);
