import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  fallback,
  http,
  isAddress,
  type Abi,
  type Address,
  type EIP1193Provider,
} from "viem";
import { abiHash } from "./integrity";

export type Provider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
};
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
export interface Deployment {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
    abi: Abi;
  }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: Record<
      | "poolManager"
      | "universalRouter"
      | "quoter"
      | "stateView"
      | "positionManager"
      | "permit2",
      Address
    >;
  };
  walletAddChain: {
    chainId: `0x${string}`;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
  manifest: {
    token: { contract: string; name: string; symbol: string; decimals: number };
    hook: {
      contract: string;
      permissions: string[];
      constructorArgs: Address[];
    };
    pool: {
      pairedCurrency: Address;
      fee: number;
      tickSpacing: number;
      initialPrice: string;
    };
  };
}
async function json(path: string) {
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok)
    throw new Error(
      `Could not load ${path} (${response.status}). Reload the page.`,
    );
  return response.json();
}
export async function loadDeployment(): Promise<Deployment> {
  const config = (await json("./imd-deployment.json")) as Deployment;
  if (
    config.version !== 1 ||
    !config.network ||
    !config.manifest ||
    config.chainId !== config.network.chainId ||
    config.chainId !== Number(config.walletAddChain?.chainId)
  ) {
    throw new Error(
      "Deployment network is missing or inconsistent. Transactions are unavailable.",
    );
  }
  if (
    config.contracts.length !== 2 ||
    new Set(config.contracts.map((c) => c.name)).size !== 2
  )
    throw Error("Unexpected contract set.");
  for (const contract of config.contracts) {
    if (
      !isAddress(contract.address) ||
      !/^[a-zA-Z0-9_/-]+\.json$/.test(contract.abiPath) ||
      contract.abiPath.startsWith("/") ||
      contract.abiPath.includes("..")
    )
      throw Error("Invalid deployment entry.");
    const abi = await json(`./${contract.abiPath}`);
    if (!Array.isArray(abi) || abiHash(abi) !== contract.abiHash)
      throw Error(
        `ABI verification failed for ${contract.name}. Transactions are unavailable.`,
      );
    contract.abi = abi;
  }
  for (const address of Object.values(config.network.uniswapV4))
    if (!isAddress(address)) throw Error("Invalid Uniswap address.");
  getContract(config, config.manifest.token.contract);
  getContract(config, config.manifest.hook.contract);
  return config;
}
export function getContract(config: Deployment, name: string) {
  const contract = config.contracts.find((c) => c.name === name);
  if (!contract) throw Error(`Missing contract: ${name}`);
  return contract;
}
export function chainFor(config: Deployment) {
  return defineChain({
    id: config.chainId,
    name: config.network.name,
    nativeCurrency: config.network.nativeCurrency,
    rpcUrls: { default: { http: config.network.rpcUrls } },
    blockExplorers: {
      default: { name: "Explorer", url: config.network.explorer },
    },
    testnet: config.network.testnet,
  });
}
export function publicClient(
  config: Deployment,
  provider?: Provider,
  walletChain?: number,
) {
  return createPublicClient({
    chain: chainFor(config),
    transport: fallback(
      [
        ...config.network.rpcUrls.map((url) =>
          http(url, { timeout: 7000, retryCount: 0, batch: true }),
        ),
        ...(provider && walletChain === config.chainId
          ? [custom(provider, { retryCount: 0 })]
          : []),
      ],
      { retryCount: 0 },
    ),
  });
}
export function walletClient(
  config: Deployment,
  provider: Provider,
  account: Address,
) {
  return createWalletClient({
    account,
    chain: chainFor(config),
    transport: custom(provider),
  });
}
export async function switchNetwork(provider: Provider, config: Deployment) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: config.walletAddChain.chainId }],
    });
  } catch (error) {
    const e = error as {
      code?: number;
      message?: string;
      data?: { originalError?: { code?: number } };
    };
    if (
      e.code !== 4902 &&
      e.data?.originalError?.code !== 4902 &&
      !/unknown chain|unrecognized chain|chain.*not.*added/i.test(
        e.message ?? "",
      )
    )
      throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [config.walletAddChain],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: config.walletAddChain.chainId }],
    });
  }
}
export function errorMessage(error: unknown) {
  const e = error as { shortMessage?: string; message?: string; code?: number };
  if (
    e.code === 4001 ||
    /rejected|denied/i.test(e.shortMessage ?? e.message ?? "")
  )
    return "Request rejected in your wallet. You can try again.";
  return (
    e.shortMessage ??
    e.message ??
    "Request failed. Check your connection and try again."
  ).slice(0, 700);
}
