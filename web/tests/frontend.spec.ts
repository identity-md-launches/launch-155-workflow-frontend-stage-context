import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync } from "node:fs";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionResult,
  parseAbiParameters,
  type Abi,
} from "viem";
import {
  permitAbi,
  quoterAbi,
  routerAbi,
  stateAbi,
  poolKeyType,
} from "../src/protocol";

const config = JSON.parse(
  readFileSync(
    new URL("../../dist/imd-deployment.json", import.meta.url),
    "utf8",
  ),
);
const token = config.contracts.find(
  (c: { name: string }) => c.name === config.manifest.token.contract,
);
const hook = config.contracts.find(
  (c: { name: string }) => c.name === config.manifest.hook.contract,
);
const tokenAbi = JSON.parse(
  readFileSync(new URL(`../../dist/${token.abiPath}`, import.meta.url), "utf8"),
) as Abi;
const hookAbi = JSON.parse(
  readFileSync(new URL(`../../dist/${hook.abiPath}`, import.meta.url), "utf8"),
) as Abi;
const account = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const hash = `0x${"aa".repeat(32)}`;
const net = config.network.uniswapV4;
type Rpc = { method: string; params?: any[]; id?: number };

async function setup(
  page: Page,
  options: {
    noWallet?: boolean;
    wrongChain?: boolean;
    rejectConnect?: boolean;
    missingCode?: boolean;
    noPool?: boolean;
    quoteRevert?: boolean;
    swapRevert?: boolean;
    rpcWrongChain?: boolean;
  } = {},
) {
  let chain = options.wrongChain ? "0x1" : config.walletAddChain.chainId;
  let unknown = !!options.wrongChain;
  let currentAccount = account;
  let tokenAllowance = 0n;
  let routerAllowance = 0n;
  let expiration = 0;
  const calls: Rpc[] = [];
  const sent: any[] = [];
  const simulations: any[] = [];
  const errors: string[] = [];
  const resources: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      resources.push(`${response.status()} ${response.url()}`);
  });
  const block = {
    number: "0xb3b588",
    hash,
    parentHash: hash,
    nonce: "0x0000000000000000",
    sha3Uncles: hash,
    logsBloom: `0x${"00".repeat(256)}`,
    transactionsRoot: hash,
    stateRoot: hash,
    receiptsRoot: hash,
    miner: account,
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    size: "0x100",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
    transactions: [],
    uncles: [],
    baseFeePerGas: "0x1",
  };
  function respond(request: Rpc): any {
    calls.push(request);
    const params = request.params ?? [];
    if (request.method === "eth_chainId")
      return options.rpcWrongChain ? "0x1" : config.walletAddChain.chainId;
    if (request.method === "eth_getCode")
      return options.missingCode && params[0].toLowerCase() === hook.address
        ? "0x"
        : "0x60006000";
    if (request.method === "eth_getBlockByNumber") return block;
    if (request.method === "eth_blockNumber") return block.number;
    if (request.method === "eth_getBalance") return "0x8ac7230489e80000"; // 10 ETH
    if (request.method === "eth_getTransactionReceipt")
      return {
        transactionHash: hash,
        transactionIndex: "0x0",
        blockHash: hash,
        blockNumber: block.number,
        from: account,
        to: sent.at(-1)?.to ?? token.address,
        cumulativeGasUsed: "0x5208",
        gasUsed: "0x5208",
        effectiveGasPrice: "0x1",
        contractAddress: null,
        logs: [],
        logsBloom: `0x${"00".repeat(256)}`,
        status: "0x1",
        type: "0x2",
      };
    if (request.method !== "eth_call")
      throw Error(`Unexpected RPC ${request.method}`);
    const { to, data } = params[0];
    let abi: Abi = tokenAbi;
    if (to.toLowerCase() === hook.address) abi = hookAbi;
    else if (to.toLowerCase() === net.stateView) abi = stateAbi;
    else if (to.toLowerCase() === net.quoter) abi = quoterAbi;
    else if (to.toLowerCase() === net.permit2) abi = permitAbi;
    else if (to.toLowerCase() === net.universalRouter) abi = routerAbi;
    const decoded = decodeFunctionData({ abi, data });
    const args: any = decoded.args;
    let result: any;
    switch (decoded.functionName) {
      case "totalSupply":
        result = 10n ** 27n;
        break;
      case "decimals":
        result = 18;
        break;
      case "symbol":
        result = "NOOP";
        break;
      case "name":
        result = "Noop Hook Token";
        break;
      case "balanceOf":
        result = 1000n * 10n ** 18n;
        break;
      case "poolManager":
        result = net.poolManager;
        break;
      case "getHookPermissions": {
        const entry: any = hookAbi.find(
          (a: any) => a.name === "getHookPermissions",
        );
        result = Object.fromEntries(
          entry.outputs[0].components.map((c: any) => [
            c.name,
            ["beforeSwap", "afterSwap"].includes(c.name),
          ]),
        );
        break;
      }
      case "getSlot0":
        result = [options.noPool ? 0n : 2n ** 96n, 0, 0, 3000];
        break;
      case "getLiquidity":
        result = options.noPool ? 0n : 10n ** 20n;
        break;
      case "allowance":
        result =
          to.toLowerCase() === net.permit2
            ? [routerAllowance, expiration, 0]
            : tokenAllowance;
        break;
      case "quoteExactInputSingle":
        if (options.quoteRevert) throw Error("Quote reverted: no liquidity");
        expect(to.toLowerCase()).toBe(net.quoter);
        expect(args[0].poolKey.hooks.toLowerCase()).toBe(hook.address);
        expect(args[0].poolKey.fee).toBe(config.manifest.pool.fee);
        expect(args[0].poolKey.tickSpacing).toBe(
          config.manifest.pool.tickSpacing,
        );
        result = [args[0].exactAmount * 2n, 100000n];
        break;
      case "execute":
        if (options.swapRevert)
          throw Error("Swap simulation reverted: minimum output");
        simulations.push(params[0]);
        result = undefined;
        break;
      case "approve":
      case "transfer":
      case "transferFrom":
        result = to.toLowerCase() === net.permit2 ? undefined : true;
        break;
      default:
        throw Error(`Unexpected call ${decoded.functionName}`);
    }
    return encodeFunctionResult({
      abi,
      functionName: decoded.functionName,
      result,
    });
  }
  for (const url of config.network.rpcUrls)
    await page.route(`${url}/**`, async (route) => {
      const body = route.request().postDataJSON();
      const one = (request: Rpc) => {
        try {
          return { jsonrpc: "2.0", id: request.id, result: respond(request) };
        } catch (error) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: 3, message: String(error), data: "0x" },
          };
        }
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)),
      });
    });
  // Exact-origin pattern also catches URLs with no trailing slash in every browser.
  await page.route(
    (url) => config.network.rpcUrls.includes(url.href.replace(/\/$/, "")),
    async (route) => {
      const body = route.request().postDataJSON();
      const one = (request: Rpc) => {
        try {
          return { jsonrpc: "2.0", id: request.id, result: respond(request) };
        } catch (error) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: 3, message: String(error), data: "0x" },
          };
        }
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)),
      });
    },
  );
  if (!options.noWallet) {
    await page.exposeFunction("mockWallet", async (request: Rpc) => {
      calls.push(request);
      if (request.method === "eth_requestAccounts" && options.rejectConnect)
        return { error: { code: 4001, message: "User rejected request" } };
      if (
        request.method === "eth_requestAccounts" ||
        request.method === "eth_accounts"
      )
        return { result: [currentAccount] };
      if (request.method === "eth_chainId") return { result: chain };
      if (request.method === "wallet_switchEthereumChain") {
        if (unknown) return { error: { code: 4902, message: "Unknown chain" } };
        chain = config.walletAddChain.chainId;
        return { result: null };
      }
      if (request.method === "wallet_addEthereumChain") {
        unknown = false;
        return { result: null };
      }
      if (request.method === "eth_sendTransaction") {
        const tx = request.params![0];
        sent.push(tx);
        const to = tx.to.toLowerCase();
        if (to === token.address) {
          const decoded = decodeFunctionData({ abi: tokenAbi, data: tx.data });
          if (decoded.functionName === "approve")
            tokenAllowance = decoded.args![1] as bigint;
        } else if (to === net.permit2) {
          const decoded = decodeFunctionData({ abi: permitAbi, data: tx.data });
          routerAllowance = decoded.args![2] as bigint;
          expiration = decoded.args![3] as number;
        }
        return { result: hash };
      }
      return { result: respond(request) };
    });
    await page.addInitScript(() => {
      const listeners = new Map<string, Function[]>();
      (window as any).ethereum = {
        request: async (request: any) => {
          const response = await (window as any).mockWallet(request);
          if (response.error) throw response.error;
          return response.result;
        },
        on: (event: string, fn: Function) =>
          listeners.set(event, [...(listeners.get(event) ?? []), fn]),
        removeListener: (event: string, fn: Function) =>
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter((f) => f !== fn),
          ),
      };
      (window as any).emitWallet = (event: string, payload: any) =>
        listeners.get(event)?.forEach((fn) => fn(payload));
    });
  }
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "A hook with nothing to add." }),
  ).toBeVisible();
  return {
    calls,
    sent,
    simulations,
    errors,
    resources,
    setAccount: (value: string) => {
      currentAccount = value;
    },
  };
}
async function connect(page: Page) {
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await expect(page.getByRole("button", { name: "Get Quote" })).toBeEnabled();
}
async function quote(page: Page, value = "0.1") {
  await page.getByLabel("You Pay", { exact: true }).fill(value);
  await page.getByRole("button", { name: "Get Quote" }).click();
  await expect(
    page.getByText("Minimum Received", { exact: true }),
  ).toBeVisible();
}

test("static subpath, disconnected safeguards, desktop and mobile layout", async ({
  page,
}) => {
  const env = await setup(page);
  await expect(
    page.getByText("Deployment verified", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Get Quote" })).toBeDisabled();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 980 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width !== 320)
      await page.screenshot({
        path: `../docs/frontend/${width === 1440 ? "desktop" : "mobile"}.png`,
        fullPage: true,
      });
  }
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  expect(env.errors).toEqual([]);
  expect(env.resources).toEqual([]);
});
test("missing wallet and rejected connection are actionable", async ({
  page,
}) => {
  await setup(page, { noWallet: true });
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "No browser wallet found",
  );
});
test("rejected connection never sends a transaction", async ({ page }) => {
  const env = await setup(page, { rejectConnect: true });
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await expect(page.getByRole("alert")).toContainText("Request rejected");
  expect(env.sent).toHaveLength(0);
});
test("unknown chain offers exact add-chain handoff then switches again", async ({
  page,
}) => {
  const env = await setup(page, { wrongChain: true });
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await expect(page.getByRole("button", { name: "Get Quote" })).toBeDisabled();
  await page.getByRole("button", { name: "Switch to Sepolia" }).click();
  await expect(page.getByRole("button", { name: "Get Quote" })).toBeEnabled();
  const networkCalls = env.calls.filter((c) => c.method.startsWith("wallet_"));
  expect(networkCalls.map((c) => c.method)).toEqual([
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
  ]);
  expect(networkCalls[1].params).toEqual([config.walletAddChain]);
});
test("native buy encodes minimum, actions, currencies, value and deadline; confirms receipt", async ({
  page,
}) => {
  const env = await setup(page);
  await connect(page);
  await quote(page);
  await expect(page.getByText("0.199 NOOP", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Simulate & Swap" }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  expect(env.sent).toHaveLength(1);
  expect(env.simulations).toHaveLength(1);
  const tx = env.sent[0];
  expect(tx.to.toLowerCase()).toBe(net.universalRouter);
  expect(BigInt(tx.value)).toBe(10n ** 17n);
  const decoded = decodeFunctionData({ abi: routerAbi, data: tx.data });
  const [commands, inputs, deadline] = decoded.args!;
  expect(commands).toBe("0x10");
  expect(Number(deadline)).toBeGreaterThan(Date.now() / 1000 + 250);
  const [actions, params] = decodeAbiParameters(
    parseAbiParameters("bytes,bytes[]"),
    inputs[0],
  );
  expect(actions).toBe("0x060c0f");
  const [swap] = decodeAbiParameters(
    parseAbiParameters(
      `(${poolKeyType} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`,
    ),
    params[0],
  );
  expect(swap.amountIn).toBe(10n ** 17n);
  expect(swap.amountOutMinimum).toBe(199n * 10n ** 15n);
  expect(swap.zeroForOne).toBe(true);
  const [inputCurrency, inputAmount] = decodeAbiParameters(
    parseAbiParameters("address,uint256"),
    params[1],
  );
  const [outputCurrency, minimum] = decodeAbiParameters(
    parseAbiParameters("address,uint256"),
    params[2],
  );
  expect(inputCurrency).toBe(config.manifest.pool.pairedCurrency);
  expect(inputAmount).toBe(swap.amountIn);
  expect(outputCurrency.toLowerCase()).toBe(token.address);
  expect(minimum).toBe(swap.amountOutMinimum);
  expect(
    env.calls.filter((c) => c.method === "eth_sendTransaction"),
  ).toHaveLength(1);
});
test("sell requires exact token approval and expiring Permit2 router approval", async ({
  page,
}) => {
  const env = await setup(page);
  await connect(page);
  await page.getByRole("button", { name: "Sell NOOP", exact: true }).click();
  await quote(page, "2");
  await expect(
    page.getByRole("button", { name: "Simulate & Swap" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "1. Approve NOOP to Permit2" })
    .click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await quote(page, "2");
  await page
    .getByRole("button", { name: "2. Approve Router for 30 Minutes" })
    .click();
  await expect(
    page.getByText("Router approval confirmed.", { exact: false }),
  ).toBeVisible();
  await quote(page, "2");
  await page.getByRole("button", { name: "Simulate & Swap" }).click();
  await expect(
    page.getByText("Swap confirmed.", { exact: false }),
  ).toBeVisible();
  expect(env.sent).toHaveLength(3);
  const approval = decodeFunctionData({
    abi: tokenAbi,
    data: env.sent[0].data,
  });
  expect(String(approval.args![0]).toLowerCase()).toBe(net.permit2);
  expect(approval.args![1]).toBe(2n * 10n ** 18n);
  const permit = decodeFunctionData({ abi: permitAbi, data: env.sent[1].data });
  expect(env.sent[1].to.toLowerCase()).toBe(net.permit2);
  expect(permit.args![0].toLowerCase()).toBe(token.address);
  expect(permit.args![1].toLowerCase()).toBe(net.universalRouter);
  expect(permit.args![2]).toBe(2n * 10n ** 18n);
  expect(permit.args![3]).toBeGreaterThan(Date.now() / 1000 + 1700);
  expect(BigInt(env.sent[2].value ?? "0x0")).toBe(0n);
});
test("input validation, insufficient balance and quote invalidation", async ({
  page,
}) => {
  const env = await setup(page);
  await connect(page);
  for (const [value, message] of [
    ["0", "greater than zero"],
    ["0.0000000000000000001", "18 decimal places"],
    ["100", "Insufficient ETH"],
  ]) {
    await page.getByLabel("You Pay", { exact: true }).fill(value);
    await page.getByRole("button", { name: "Get Quote" }).click();
    await expect(page.getByRole("alert")).toContainText(message);
  }
  await page.getByLabel("You Pay", { exact: true }).fill("0.1");
  await page.getByLabel("Slippage Tolerance").fill("6");
  await page.getByRole("button", { name: "Get Quote" }).click();
  await expect(page.getByRole("alert")).toContainText("between 0.01% and 5%");
  await page.getByLabel("Slippage Tolerance").fill("0.5");
  await quote(page);
  await page.getByLabel("Slippage Tolerance").fill("1");
  await expect(
    page.getByRole("button", { name: "Simulate & Swap" }),
  ).toHaveCount(0);
  expect(env.sent).toHaveLength(0);
});
test("quote expires and account changes remove it", async ({ page }) => {
  const env = await setup(page);
  await connect(page);
  await quote(page);
  await page.clock.install();
  await page.clock.fastForward(61000);
  await expect(
    page.getByRole("button", { name: "Simulate & Swap" }),
  ).toBeDisabled();
  await expect(page.getByText("Expired — request a new quote")).toBeVisible();
  await quote(page);
  env.setAccount(other);
  await page.evaluate(
    (value) => (window as any).emitWallet("accountsChanged", [value]),
    other,
  );
  await expect(
    page.getByRole("button", { name: "Simulate & Swap" }),
  ).toHaveCount(0);
  expect(env.sent).toHaveLength(0);
});
for (const [name, options, message] of [
  ["empty contract code", { missingCode: true }, "no deployed code"],
  ["RPC on wrong chain", { rpcWrongChain: true }, "RPC chain does not match"],
  ["uninitialized pool", { noPool: true }, "Not initialized"],
] as const)
  test(`${name} disables transactions`, async ({ page }) => {
    const env = await setup(page, options);
    await page.getByRole("button", { name: "Connect Wallet" }).click();
    await expect(
      page.getByText(message, { exact: false }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Get Quote" }),
    ).toBeDisabled();
    expect(env.sent).toHaveLength(0);
  });
for (const step of ["quote", "swap"])
  test(`${step} revert is reported without sending`, async ({ page }) => {
    const env = await setup(page, {
      quoteRevert: step === "quote",
      swapRevert: step === "swap",
    });
    await connect(page);
    if (step === "swap") {
      await quote(page);
      await page.getByRole("button", { name: "Simulate & Swap" }).click();
    } else {
      await page.getByLabel("You Pay", { exact: true }).fill("0.1");
      await page.getByRole("button", { name: "Get Quote" }).click();
    }
    await expect(page.getByRole("alert")).toBeVisible();
    expect(env.sent).toHaveLength(0);
  });
test("ERC20 transfer, revoke, allowance read and delegated transfer", async ({
  page,
}) => {
  const env = await setup(page);
  await connect(page);
  await page.getByText("Token Controls", { exact: false }).click();
  await page.getByLabel("Recipient Address").fill(other);
  await page.getByLabel("Amount (NOOP)").fill("1");
  await page
    .getByRole("button", { name: "Simulate & Transfer", exact: true })
    .click();
  await expect(
    page.getByText("Token transfer confirmed.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Action", { exact: true }).selectOption("approve");
  await page.getByLabel("Amount (NOOP)").fill("0");
  await page.getByRole("button", { name: "Read Allowance" }).click();
  await expect(page.getByText("Current allowance: 0 NOOP")).toBeVisible();
  await page.getByRole("button", { name: "Simulate & Set Allowance" }).click();
  await expect(
    page.getByText("Token allowance update confirmed.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Action", { exact: true }).selectOption("transferFrom");
  await page.getByLabel("Token Owner", { exact: true }).fill(account);
  await page.getByLabel("Amount (NOOP)").fill("1");
  await page
    .getByRole("button", { name: "Simulate & Transfer", exact: true })
    .click();
  await expect(
    page.getByText("Token transfer confirmed.", { exact: false }),
  ).toBeVisible();
  expect(
    env.sent.map(
      (tx) => decodeFunctionData({ abi: tokenAbi, data: tx.data }).functionName,
    ),
  ).toEqual(["transfer", "approve", "transferFrom"]);
});
test("tampered ABI prevents app initialization", async ({ page }) => {
  await page.route("**/abi/NoopToken.json", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" }),
  );
  await page.goto("./");
  await expect(page.getByRole("alert")).toContainText(
    "ABI verification failed",
  );
  await expect(
    page.getByRole("button", { name: "Connect Wallet" }),
  ).toHaveCount(0);
});

test('accessibility audit, focus, and full controls at narrow widths', async ({ page }) => {
  await setup(page); await connect(page);
  await page.getByText('Token Controls', { exact: false }).click();
  await page.getByText('Pool & Deployment Details', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByText('Connected:', { exact: false })).toBeVisible();
  await page.getByLabel('You Pay', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Get Quote' }).click();
  await expect(page.getByLabel('You Pay', { exact: true })).toBeFocused();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  writeFileSync('../docs/frontend/accessibility.json', JSON.stringify({ checkedAt: new Date().toISOString(), engine: results.testEngine, url: results.url, violations: results.violations, passes: results.passes.map(p => p.id), incomplete: results.incomplete.map(p => ({ id: p.id, description: p.description })) }, null, 2));
  expect(results.violations).toEqual([]);
});

test('missing network configuration fails closed', async ({ page }) => {
  await page.route('**/imd-deployment.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...config, network: undefined }) }));
  await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('network is missing or inconsistent');
  await expect(page.getByRole('button', { name: 'Connect Wallet' })).toHaveCount(0);
});
