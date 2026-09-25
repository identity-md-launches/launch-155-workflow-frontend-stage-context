import { type Address } from "viem";
import { getContract, type Deployment, type publicClient } from "./config";
import { permitAbi, poolId, stateAbi } from "./protocol";

export type Client = ReturnType<typeof publicClient>;
export interface Snapshot {
  block: bigint;
  timestamp: bigint;
  supply: bigint;
  decimals: number;
  symbol: string;
  name: string;
  nativeBalance: bigint;
  tokenBalance: bigint;
  tokenAllowance: bigint;
  routerAllowance: bigint;
  expiration: number;
  sqrtPrice: bigint;
  tick: number;
  liquidity: bigint;
  lpFee: number;
  permissions: Record<string, boolean>;
}
export async function readSnapshot(
  config: Deployment,
  client: Client,
  account?: Address,
): Promise<Snapshot> {
  if ((await client.getChainId()) !== config.chainId)
    throw Error(
      "RPC chain does not match the deployment. Transactions are disabled.",
    );
  const contracts = [
    getContract(config, config.manifest.token.contract),
    getContract(config, config.manifest.hook.contract),
  ];
  const [token, hook] = contracts;
  const network = config.network.uniswapV4;
  const addresses = [
    ...contracts.map((c) => c.address),
    ...Object.values(network),
  ];
  const codes = await Promise.all(
    addresses.map((address) => client.getCode({ address })),
  );
  if (codes.some((code) => !code || code === "0x"))
    throw Error(
      "A configured contract has no deployed code. Transactions are disabled.",
    );
  const block = await client.getBlock();
  const blockNumber = block.number;
  const readToken = (functionName: string, args?: readonly unknown[]) =>
    client.readContract({
      address: token.address,
      abi: token.abi,
      functionName,
      args,
      blockNumber,
    });
  const [
    supply,
    decimals,
    symbol,
    name,
    manager,
    permissions,
    slot,
    liquidity,
    nativeBalance,
    tokenBalance,
    tokenAllowance,
    allowance,
  ] = await Promise.all([
    readToken("totalSupply"),
    readToken("decimals"),
    readToken("symbol"),
    readToken("name"),
    client.readContract({
      address: hook.address,
      abi: hook.abi,
      functionName: "poolManager",
      blockNumber,
    }),
    client.readContract({
      address: hook.address,
      abi: hook.abi,
      functionName: "getHookPermissions",
      blockNumber,
    }),
    client.readContract({
      address: network.stateView,
      abi: stateAbi,
      functionName: "getSlot0",
      args: [poolId(config)],
      blockNumber,
    }),
    client.readContract({
      address: network.stateView,
      abi: stateAbi,
      functionName: "getLiquidity",
      args: [poolId(config)],
      blockNumber,
    }),
    account ? client.getBalance({ address: account, blockNumber }) : 0n,
    account ? readToken("balanceOf", [account]) : 0n,
    account ? readToken("allowance", [account, network.permit2]) : 0n,
    account
      ? client.readContract({
          address: network.permit2,
          abi: permitAbi,
          functionName: "allowance",
          args: [account, token.address, network.universalRouter],
          blockNumber,
        })
      : ([0n, 0, 0] as const),
  ]);
  if (String(manager).toLowerCase() !== network.poolManager.toLowerCase())
    throw Error("Hook PoolManager does not match the network handoff.");
  const flags = permissions as Record<string, boolean>;
  if (
    Object.keys(flags).length !== 14 ||
    Object.entries(flags).some(
      ([name, value]) =>
        value !== config.manifest.hook.permissions.includes(name),
    )
  )
    throw Error("Hook permissions do not match the handoff.");
  if (
    decimals !== config.manifest.token.decimals ||
    name !== config.manifest.token.name ||
    symbol !== config.manifest.token.symbol ||
    supply !== 10n ** 27n
  )
    throw Error(
      "Token metadata or supply does not match the approved deployment.",
    );
  return {
    block: blockNumber,
    timestamp: block.timestamp,
    supply: supply as bigint,
    decimals: decimals as number,
    symbol: symbol as string,
    name: name as string,
    nativeBalance,
    tokenBalance: tokenBalance as bigint,
    tokenAllowance: tokenAllowance as bigint,
    routerAllowance: allowance[0],
    expiration: allowance[1],
    sqrtPrice: slot[0],
    tick: slot[1],
    lpFee: slot[3],
    liquidity,
    permissions: flags,
  };
}
