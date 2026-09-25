import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  formatUnits,
  isAddress,
  zeroAddress,
  type Abi,
  type Address,
  type Hash,
} from "viem";
import {
  errorMessage,
  getContract,
  publicClient,
  switchNetwork,
  walletClient,
  type Deployment,
} from "./config";
import { readSnapshot, type Snapshot } from "./chain";
import {
  currencies,
  minimumOutput,
  permitAbi,
  poolId,
  poolKey,
  positiveAmount,
  quoterAbi,
  slippageBps,
  swapCall,
} from "./protocol";

type Quote = {
  amount: bigint;
  output: bigint;
  minimum: bigint;
  time: number;
  buy: boolean;
  account: Address;
};
type Call = {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
};
const number = (value: number, digits = 6) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(
    value,
  );
const units = (value: bigint, decimals = 18) =>
  number(Number(formatUnits(value, decimals)));
const short = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

export function App({ config }: { config: Deployment }) {
  const [account, setAccount] = useState<Address>();
  const [walletChain, setWalletChain] = useState<number>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [readError, setReadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [errorArea, setErrorArea] = useState("wallet");
  const [tx, setTx] = useState<{ hash: Hash; state: string }>();
  const [buy, setBuy] = useState(location.hash !== "#sell");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.50");
  const [quote, setQuote] = useState<Quote>();
  const [now, setNow] = useState(Date.now());
  const [mode, setMode] = useState("transfer");
  const [recipient, setRecipient] = useState("");
  const [owner, setOwner] = useState("");
  const [tokenAmount, setTokenAmount] = useState("");
  const [allowanceInfo, setAllowanceInfo] = useState("");
  const epoch = useRef(0);
  const readSequence = useRef(0);
  const lock = useRef(false);
  const provider = window.ethereum;
  const client = useMemo(
    () => publicClient(config, provider, walletChain),
    [config, provider, walletChain],
  );
  const token = getContract(config, config.manifest.token.contract);
  const native = config.network.nativeCurrency.symbol;
  const symbol = config.manifest.token.symbol;
  const network = config.network.uniswapV4;
  const correctChain = walletChain === config.chainId;
  const verified = !!snapshot && !readError && !loading;
  const ready = !!account && correctChain && verified && !busy;
  const poolReady =
    !!snapshot && snapshot.sqrtPrice > 0n && snapshot.liquidity > 0n;
  const nativePair = config.manifest.pool.pairedCurrency === zeroAddress;
  const quoteValid =
    !!quote &&
    now - quote.time < 60000 &&
    quote.account === account &&
    quote.buy === buy;
  const allowanceToken =
    !!quote && !!snapshot && snapshot.tokenAllowance >= quote.amount;
  const allowanceRouter =
    !!quote &&
    !!snapshot &&
    snapshot.routerAllowance >= quote.amount &&
    snapshot.expiration > now / 1000 + 60;
  const explorer = (kind: "address" | "tx", value: string) =>
    `${config.network.explorer}/${kind}/${value}`;

  const refresh = useCallback(async () => {
    const sequence = ++readSequence.current;
    setLoading(true);
    try {
      const state = await readSnapshot(config, client, account);
      if (sequence === readSequence.current) {
        setSnapshot(state);
        setReadError("");
      }
    } catch (e) {
      if (sequence === readSequence.current) {
        setSnapshot(undefined);
        setReadError(errorMessage(e));
      }
    } finally {
      if (sequence === readSequence.current) setLoading(false);
    }
  }, [config, client, account]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      clearInterval(timer);
      readSequence.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const changed = () => {
      if (["#buy", "#sell"].includes(location.hash)) {
        setBuy(location.hash !== "#sell");
        setQuote(undefined);
      }
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (!provider) return;
    const reset = () => {
      epoch.current++;
      setQuote(undefined);
      setSnapshot(undefined);
      setAllowanceInfo("");
      setError("");
      setNotice("Wallet changed. Refreshing verification…");
    };
    const accountsChanged = (value: unknown) => {
      reset();
      setAccount((value as Address[])[0]);
    };
    const chainChanged = (value: unknown) => {
      reset();
      setWalletChain(Number(value));
    };
    const disconnected = () => {
      reset();
      setAccount(undefined);
      setWalletChain(undefined);
    };
    provider.on?.("accountsChanged", accountsChanged);
    provider.on?.("chainChanged", chainChanged);
    provider.on?.("disconnect", disconnected);
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
      provider.removeListener?.("disconnect", disconnected);
    };
  }, [provider]);

  async function task(label: string, fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    const area = /Connecting|Switching/.test(label)
      ? "wallet"
      : /token action|Reading allowance/.test(label)
        ? "token"
        : "swap";
    setErrorArea(area);
    try {
      await fn();
    } catch (e) {
      const message = errorMessage(e);
      setError(message);
      const field = /slippage/i.test(message)
        ? "slippage"
        : /owner/i.test(message)
          ? "owner"
          : /recipient|spender address/i.test(message)
            ? "recipient"
            : /amount|balance|decimal/i.test(message)
              ? area === "token"
                ? "tokenAmount"
                : "swapAmount"
              : undefined;
      if (field)
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLInputElement>(`[name="${field}"]`)
            ?.focus(),
        );
    } finally {
      setBusy("");
      lock.current = false;
    }
  }
  async function connect() {
    await task("Connecting…", async () => {
      if (!provider)
        throw Error(
          "No browser wallet found. Install an Ethereum browser wallet, then reload this page.",
        );
      const accounts = await provider.request({
        method: "eth_requestAccounts",
      });
      const chain = await provider.request({ method: "eth_chainId" });
      epoch.current++;
      setQuote(undefined);
      setAccount(accounts[0]);
      setWalletChain(Number(chain));
      setNotice(
        "Wallet connected. Review the live state before sending a transaction.",
      );
    });
  }
  async function assertWallet(expectedEpoch: number) {
    if (!provider || !account) throw Error("Connect your wallet first.");
    const [chain, accounts] = await Promise.all([
      provider.request({ method: "eth_chainId" }),
      provider.request({ method: "eth_accounts" }),
    ]);
    if (
      expectedEpoch !== epoch.current ||
      Number(chain) !== config.chainId ||
      accounts[0]?.toLowerCase() !== account.toLowerCase()
    )
      throw Error(
        "Wallet changed. Reconnect, verify the network and try again.",
      );
  }
  async function send(call: Call, label: string, expires?: number) {
    if (!provider || !account || !verified || !correctChain)
      throw Error("Connect on the verified deployment network first.");
    const currentEpoch = epoch.current;
    await assertWallet(currentEpoch);
    // Recheck chain and code at the moment of signing, not only at page load.
    if ((await client.getChainId()) !== config.chainId)
      throw Error("RPC network changed. Reload and retry.");
    const codes = await Promise.all(
      [...config.contracts.map((c) => c.address), call.address].map((address) =>
        client.getCode({ address }),
      ),
    );
    if (codes.some((code) => !code || code === "0x"))
      throw Error("Contract code unavailable. No signature requested.");
    setNotice(`Simulating ${label.toLowerCase()}…`);
    const simulation = await client.simulateContract({ ...call, account });
    await assertWallet(currentEpoch);
    if (expires && Date.now() >= expires)
      throw Error("Quote expired during simulation. Request a new quote.");
    setNotice(
      "Simulation passed. Review the amount, recipient and network in your wallet.",
    );
    const hash = await walletClient(config, provider, account).writeContract(
      simulation.request,
    );
    setTx({ hash, state: "Pending confirmation" });
    setQuote(undefined);
    setNotice(`${label} submitted. Waiting for a receipt…`);
    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: 120000,
    });
    setTx({
      hash,
      state: receipt.status === "success" ? "Confirmed" : "Reverted",
    });
    if (receipt.status !== "success")
      throw Error(
        "Transaction reverted. Inspect the explorer receipt before retrying.",
      );
    setNotice(`${label} confirmed.`);
    if (currentEpoch === epoch.current) await refresh();
  }
  async function getQuote(event: FormEvent) {
    event.preventDefault();
    await task("Quoting…", async () => {
      setQuote(undefined);
      if (!ready || !account || !poolReady || !nativePair)
        throw Error(
          "Connect on the correct network and wait for a verified, liquid pool.",
        );
      const input = positiveAmount(
        amount,
        buy
          ? config.network.nativeCurrency.decimals
          : config.manifest.token.decimals,
      );
      const bps = slippageBps(slippage);
      if (input > (buy ? snapshot!.nativeBalance : snapshot!.tokenBalance))
        throw Error(
          `Insufficient ${buy ? native : symbol} balance. Reduce the amount.`,
        );
      const currentEpoch = epoch.current;
      const key = poolKey(config);
      const result = await client.simulateContract({
        address: network.quoter,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: key,
            zeroForOne:
              currencies(config, buy).input.toLowerCase() ===
              key.currency0.toLowerCase(),
            exactAmount: input,
            hookData: "0x",
          },
        ],
        account,
      });
      if (currentEpoch !== epoch.current)
        throw Error("Wallet changed. Request a new quote.");
      const output = result.result[0];
      const minimum = minimumOutput(output, bps);
      if (minimum <= 0n || minimum >= 2n ** 128n)
        throw Error(
          "The pool returned an unusable quote. Try a different amount.",
        );
      setQuote({
        amount: input,
        output,
        minimum,
        buy,
        account,
        time: Date.now(),
      });
      setNow(Date.now());
      setNotice(
        "Quote ready. Review the minimum received and approval steps below.",
      );
    });
  }
  function approveToken() {
    void task("Approving NOOP…", async () => {
      if (!quote || !quoteValid || !ready || buy)
        throw Error("Request a fresh sell quote first.");
      await send(
        {
          address: token.address,
          abi: token.abi,
          functionName: "approve",
          args: [network.permit2, quote.amount],
        },
        "NOOP approval",
      );
    });
  }
  function approveRouter() {
    void task("Approving router…", async () => {
      if (!quote || !quoteValid || !ready || buy || !allowanceToken)
        throw Error("Approve NOOP and request a fresh quote first.");
      await send(
        {
          address: network.permit2,
          abi: permitAbi,
          functionName: "approve",
          args: [
            token.address,
            network.universalRouter,
            quote.amount,
            Math.floor(Date.now() / 1000) + 1800,
          ],
        },
        "Router approval",
      );
    });
  }
  function swap() {
    void task("Simulating swap…", async () => {
      if (
        !quote ||
        !quoteValid ||
        !ready ||
        !poolReady ||
        !nativePair ||
        (!buy && (!allowanceToken || !allowanceRouter))
      )
        throw Error("Request a fresh quote and complete both approvals first.");
      await send(
        swapCall(
          config,
          buy,
          quote.amount,
          quote.minimum,
          BigInt(Math.floor(Date.now() / 1000) + 300),
        ),
        "Swap",
        quote.time + 60000,
      );
    });
  }
  async function tokenAction(event: FormEvent) {
    event.preventDefault();
    await task("Checking token action…", async () => {
      if (!ready || !account)
        throw Error("Connect on the verified network first.");
      if (!isAddress(recipient) || recipient.toLowerCase() === zeroAddress)
        throw Error("Enter a valid nonzero recipient or spender address.");
      if (
        mode === "transferFrom" &&
        (!isAddress(owner) || owner.toLowerCase() === zeroAddress)
      )
        throw Error("Enter the token owner’s nonzero address.");
      const value =
        tokenAmount === "0" && mode === "approve"
          ? 0n
          : positiveAmount(tokenAmount, config.manifest.token.decimals);
      if (mode === "transfer" && value > snapshot!.tokenBalance)
        throw Error("Insufficient NOOP balance. Reduce the amount.");
      await send(
        {
          address: token.address,
          abi: token.abi,
          functionName: mode,
          args:
            mode === "transferFrom"
              ? [owner, recipient, value]
              : [recipient, value],
        },
        mode === "approve" ? "Token allowance update" : "Token transfer",
      );
    });
  }
  const outputSymbol = buy ? symbol : native;
  const outputDecimals = buy
    ? config.manifest.token.decimals
    : config.network.nativeCurrency.decimals;
  const status = readError
    ? "Verification unavailable"
    : loading
      ? "Reading chain…"
      : "Deployment verified";

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="header shell">
        <a className="brand" href="./" aria-label="NOOP home">
          <span className="brand-mark" aria-hidden="true">
            n
          </span>
          NOOP<span className="brand-sub">HOOK LAB</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#deployment">Deployment</a>
          <a href="#about">About</a>
        </nav>
        <div className="wallet">
          <span className="network-chip">
            <span className="dot" />
            {config.network.name}
          </span>
          {account ? (
            <>
              <span className="mono account" title={account}>
                {short(account)}
              </span>
              <button
                className="small secondary"
                disabled={!!busy}
                onClick={() => {
                  epoch.current++;
                  setAccount(undefined);
                  setWalletChain(undefined);
                  setQuote(undefined);
                  setSnapshot(undefined);
                  setNotice("Wallet disconnected from this page.");
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button className="small" onClick={connect} disabled={!!busy}>
              Connect Wallet <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </header>
      <main id="main" className="shell">
        <section className="hero" aria-labelledby="title">
          <div>
            <p className="eyebrow">UNISWAP V4 · SEPOLIA EXPERIMENT 001</p>
            <h1 id="title">
              A hook with
              <br />
              <span>nothing to add.</span>
            </h1>
            <p className="hero-copy">
              Before a swap. After a swap. Zero changes.
              <br />
              Meet NOOP, a minimal hook built to test the complete launch flow.
            </p>
            <div className="hero-tags">
              <span>Zero hook fees</span>
              <span>No burn</span>
              <span>No allowlist</span>
            </div>
          </div>
          <div className="orbit" aria-hidden="true">
            <div className="orbit-inner">
              n<span>NOOP / 001</span>
            </div>
            <span className="orbit-label">INPUT → SWAP → OUTPUT</span>
          </div>
        </section>
        <div className="workspace">
          <section className="panel swap-panel" aria-labelledby="swap-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">TRY THE POOL</p>
                <h2 id="swap-title">Make a Test Swap</h2>
              </div>
              <span className="pill">Testnet only</span>
            </div>
            {account && (
              <p className="hint">
                Connected: <a className="mono" title={account} href={explorer("address", account)} target="_blank" rel="noreferrer">{short(account)}</a>
                {snapshot && <> · {units(snapshot.tokenBalance, snapshot.decimals)} {symbol}</>}
              </p>
            )}
            <div className="tabs" role="group" aria-label="Swap direction">
              <button
                aria-pressed={buy}
                onClick={() => {
                  setBuy(true);
                  location.hash = "buy";
                  setAmount("");
                  setQuote(undefined);
                }}
                disabled={!!busy}
              >
                Buy {symbol}
              </button>
              <button
                aria-pressed={!buy}
                onClick={() => {
                  setBuy(false);
                  location.hash = "sell";
                  setAmount("");
                  setQuote(undefined);
                }}
                disabled={!!busy}
              >
                Sell {symbol}
              </button>
            </div>
            <form onSubmit={getQuote}>
              <div className="amount-box">
                <div className="field-top">
                  <label htmlFor="swap-amount">You Pay</label>
                  <span>
                    Balance:{" "}
                    {account && snapshot
                      ? units(
                          buy ? snapshot.nativeBalance : snapshot.tokenBalance,
                        )
                      : "—"}
                  </span>
                </div>
                <div className="amount-row">
                  <input
                    id="swap-amount"
                    name="swapAmount"
                    aria-invalid={!!error && errorArea === "swap"}
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="0.00…"
                    value={amount}
                    disabled={!!busy}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setQuote(undefined);
                    }}
                    aria-describedby="amount-hint"
                  />
                  <span className="currency">
                    <span
                      className={buy ? "eth-icon" : "token-icon"}
                      aria-hidden="true"
                    >
                      {buy ? "♦" : "n"}
                    </span>
                    {buy ? native : symbol}
                  </span>
                </div>
              </div>
              <div className="down-arrow" aria-hidden="true">
                ↓
              </div>
              <div className="amount-box output">
                <div className="field-top">
                  <span>You Receive (Estimated)</span>
                  <span>{quoteValid ? "Live quote" : "Get a quote"}</span>
                </div>
                <div className="amount-row">
                  <output>
                    {quoteValid ? units(quote!.output, outputDecimals) : "—"}
                  </output>
                  <span className="currency">
                    <span
                      className={buy ? "token-icon" : "eth-icon"}
                      aria-hidden="true"
                    >
                      {buy ? "n" : "♦"}
                    </span>
                    {outputSymbol}
                  </span>
                </div>
              </div>
              <div className="slippage-row">
                <label htmlFor="slippage">Slippage Tolerance</label>
                <div>
                  <input
                    id="slippage"
                    name="slippage"
                    inputMode="decimal"
                    autoComplete="off"
                    value={slippage}
                    disabled={!!busy}
                    onChange={(e) => {
                      setSlippage(e.target.value);
                      setQuote(undefined);
                    }}
                    aria-describedby="slippage-hint"
                  />
                  <span>%</span>
                </div>
              </div>
              <p id="slippage-hint" className="hint">
                0.01–5%. The pool charges a{" "}
                {number(config.manifest.pool.fee / 10000, 2)}% LP fee. The hook
                adds no fee.
              </p>
              {error && errorArea === "swap" && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="full"
                type="submit"
                disabled={!ready || !poolReady || !nativePair}
              >
                {busy === "Quoting…" ? busy : "Get Quote"}{" "}
                <span aria-hidden="true">↗</span>
              </button>
              <p id="amount-hint" className="hint">
                {!account
                  ? "Connect a browser wallet to quote and swap."
                  : !correctChain
                    ? `Switch to ${config.network.name} to continue.`
                    : !verified
                      ? "Transactions require successful deployment verification."
                      : !poolReady
                        ? "The pool is uninitialized or has no active liquidity. Swaps are unavailable."
                        : !nativePair
                          ? "This interface supports native-currency pairs only."
                          : buy
                            ? "Keep some ETH in your wallet for network gas."
                            : "Selling uses two explicit approvals. Each needs a wallet confirmation."}
              </p>
            </form>
            {quote && (
              <div className="quote-details">
                <dl>
                  <div>
                    <dt>Minimum Received</dt>
                    <dd>
                      {formatUnits(quote.minimum, outputDecimals)}{" "}
                      {outputSymbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Exchange Rate</dt>
                    <dd>
                      1 {buy ? native : symbol} ≈{" "}
                      {number(
                        Number(formatUnits(quote.output, outputDecimals)) /
                          Number(
                            formatUnits(
                              quote.amount,
                              buy
                                ? config.network.nativeCurrency.decimals
                                : config.manifest.token.decimals,
                            ),
                          ),
                        8,
                      )}{" "}
                      {outputSymbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Quote Expires</dt>
                    <dd>
                      {quoteValid
                        ? `${Math.max(0, Math.ceil((quote.time + 60000 - now) / 1000))}s`
                        : "Expired — request a new quote"}
                    </dd>
                  </div>
                </dl>
                {!buy && (
                  <div className="approval-steps">
                    <button
                      className="secondary full"
                      disabled={!ready || !quoteValid || allowanceToken}
                      onClick={approveToken}
                    >
                      1.{" "}
                      {allowanceToken
                        ? "NOOP Approved"
                        : "Approve NOOP to Permit2"}
                    </button>
                    <button
                      className="secondary full"
                      disabled={
                        !ready ||
                        !quoteValid ||
                        !allowanceToken ||
                        allowanceRouter
                      }
                      onClick={approveRouter}
                    >
                      2.{" "}
                      {allowanceRouter
                        ? "Router Approved"
                        : "Approve Router for 30 Minutes"}
                    </button>
                    <p className="hint">
                      Each allowance is limited to{" "}
                      {formatUnits(
                        quote.amount,
                        config.manifest.token.decimals,
                      )}{" "}
                      {symbol}. Request a fresh quote after each confirmation.
                    </p>
                  </div>
                )}
                <p className="hint">
                  Send exactly{" "}
                  {formatUnits(
                    quote.amount,
                    buy
                      ? config.network.nativeCurrency.decimals
                      : config.manifest.token.decimals,
                  )}{" "}
                  {buy ? native : symbol}; receive at least the minimum above in
                  this wallet. Swap deadline: 5 minutes. Gas is extra.
                </p>
                <button
                  className="full accent"
                  onClick={swap}
                  disabled={
                    !ready ||
                    !quoteValid ||
                    !poolReady ||
                    (!buy && (!allowanceToken || !allowanceRouter))
                  }
                >
                  Simulate & Swap
                </button>
              </div>
            )}
          </section>
          <div className="observability">
            <section className="panel live-panel" aria-labelledby="live-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">ONCHAIN OBSERVABILITY</p>
                  <h2 id="live-title">Small Hook. Clear State.</h2>
                </div>
                <button
                  className="text-button"
                  disabled={loading || !!busy}
                  onClick={() => {
                    setQuote(undefined);
                    void refresh();
                  }}
                >
                  Refresh <span aria-hidden="true">↻</span>
                </button>
              </div>
              <div
                className={`verification ${readError ? "warning" : ""}`}
                role="status"
              >
                <span className="dot" />
                {status}
                <span>
                  {snapshot
                    ? `Block ${number(Number(snapshot.block), 0)}`
                    : "Public RPC"}
                </span>
              </div>
              {readError && (
                <p className="inline-error" role="alert">
                  {readError} Use Refresh to retry.
                </p>
              )}
              <dl className="stats">
                <div>
                  <dt>Total Supply</dt>
                  <dd>
                    {snapshot ? units(snapshot.supply, snapshot.decimals) : "—"}{" "}
                    <small>{symbol}</small>
                  </dd>
                </div>
                <div>
                  <dt>Hook Delta</dt>
                  <dd>
                    0 <small>by design</small>
                  </dd>
                </div>
                <div>
                  <dt>Pool Status</dt>
                  <dd className="small-value">
                    {snapshot
                      ? snapshot.sqrtPrice === 0n
                        ? "Not initialized"
                        : snapshot.liquidity === 0n
                          ? "No active liquidity"
                          : "Ready for quotes"
                      : "Awaiting RPC"}
                  </dd>
                </div>
                <div>
                  <dt>Active Liquidity</dt>
                  <dd className="small-value">
                    {snapshot
                      ? new Intl.NumberFormat(undefined, {
                          notation: "scientific",
                          maximumSignificantDigits: 4,
                        }).format(snapshot.liquidity)
                      : "—"}
                  </dd>
                </div>
              </dl>
              <div className="permissions">
                <p className="eyebrow">SWAP CALLBACKS</p>
                <div>
                  <span>beforeSwap</span>
                  <span className="permission-state">
                    {snapshot?.permissions.beforeSwap
                      ? "✓ Enabled"
                      : "Declared"}
                  </span>
                </div>
                <div>
                  <span>afterSwap</span>
                  <span className="permission-state">
                    {snapshot?.permissions.afterSwap ? "✓ Enabled" : "Declared"}
                  </span>
                </div>
                <p className="hint">
                  Both callbacks acknowledge the PoolManager and return zero
                  deltas. The factory opens the pool; the hook does not gate
                  initialization.
                </p>
              </div>
              {snapshot && (
                <p className="hint">
                  Tick {number(snapshot.tick, 0)} · Live LP fee{" "}
                  {number(snapshot.lpFee / 10000, 2)}% · {snapshot.decimals}{" "}
                  token decimals · Updated{" "}
                  {new Intl.DateTimeFormat(undefined, {
                    timeStyle: "medium",
                  }).format(new Date(Number(snapshot.timestamp) * 1000))}
                  . Reads refresh every 30 seconds.
                </p>
              )}
            </section>
            <section className="purpose-card" id="about">
              <span className="eyebrow">WHAT DOES NO-OP MEAN?</span>
              <h2>It leaves the swap alone.</h2>
              <p>
                This swarm smoke test exercises a complete token launch with the
                smallest possible hook. No hook fee, burn, allowlist, admin or
                upgrade path. Standard pool fees and network gas still apply.
              </p>
              <a href="#deployment">
                Inspect the deployment <span aria-hidden="true">↗</span>
              </a>
            </section>
          </div>
        </div>
        <section
          className="status-area"
          aria-label="Wallet and transaction status"
        >
          {account && !correctChain && (
            <div className="network-warning">
              <p>
                Your wallet is on chain {walletChain ?? "unknown"}. This
                deployment uses {config.network.name} ({config.chainId}).
              </p>
              <button
                disabled={!!busy}
                onClick={() =>
                  void task("Switching network…", async () => {
                    if (!provider) return;
                    await switchNetwork(provider, config);
                    epoch.current++;
                    setQuote(undefined);
                    setWalletChain(
                      Number(await provider.request({ method: "eth_chainId" })),
                    );
                    setNotice("Network switched. Verifying deployment…");
                  })
                }
              >
                Switch to {config.network.name}
              </button>
            </div>
          )}
          <div role="status" aria-live="polite">
            {busy && <strong>{busy} </strong>}
            {notice}
          </div>
          {error && errorArea === "wallet" && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {tx && (
            <p className="tx-status">
              <strong>{tx.state}</strong> ·{" "}
              <a
                href={explorer("tx", tx.hash)}
                target="_blank"
                rel="noreferrer"
              >
                View transaction {short(tx.hash)} ↗
              </a>
            </p>
          )}
        </section>
        <section id="deployment" className="deployment">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE DEPLOYED CONTRACTS</p>
              <h2>Trust the Addresses.</h2>
            </div>
            <a href="./imd-deployment.json" target="_blank" rel="noreferrer">
              Deployment Manifest ↗
            </a>
          </div>
          <div className="contract-grid">
            {config.contracts.map((contract) => (
              <article className="contract-card" key={contract.name}>
                <p className="eyebrow">
                  {contract.name === token.name
                    ? "FIXED-SUPPLY ERC-20"
                    : "UNISWAP V4 HOOK"}
                </p>
                <h3>{contract.name}</h3>
                <a
                  className="address"
                  translate="no"
                  href={explorer("address", contract.address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {contract.address} ↗
                </a>
                <div className="contract-bottom">
                  <span>ABI hash verified</span>
                  <a
                    href={`./${contract.abiPath}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View ABI ↗
                  </a>
                </div>
              </article>
            ))}
          </div>
          <details>
            <summary>Pool & Deployment Details</summary>
            <dl className="technical">
              <div>
                <dt>Pool ID</dt>
                <dd className="mono">{poolId(config)}</dd>
              </div>
              <div>
                <dt>PoolManager</dt>
                <dd>
                  <a
                    className="mono"
                    href={explorer("address", network.poolManager)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {network.poolManager} ↗
                  </a>
                </dd>
              </div>
              {(
                [
                  "universalRouter",
                  "quoter",
                  "permit2",
                  "stateView",
                  "positionManager",
                ] as const
              ).map((name) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>
                    <a
                      className="mono"
                      href={explorer("address", network[name])}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {network[name]} ↗
                    </a>
                  </dd>
                </div>
              ))}
              <div>
                <dt>Source Commit</dt>
                <dd className="mono">{config.sourceCommit}</dd>
              </div>
              <div>
                <dt>Attestation Hash</dt>
                <dd className="mono">{config.attestationHash}</dd>
              </div>
              <div>
                <dt>Tick Spacing</dt>
                <dd>{config.manifest.pool.tickSpacing}</dd>
              </div>
              <div>
                <dt>RPC Endpoints</dt>
                <dd>
                  {config.network.rpcUrls.map((url) => (
                    <div key={url}>{url}</div>
                  ))}
                </dd>
              </div>
            </dl>
          </details>
        </section>
        <section className="token-tools">
          <details>
            <summary>
              Token Controls{" "}
              <span>Transfer, allowance & delegated transfer</span>
            </summary>
            <p>
              NOOP is a standard ERC-20. Set an allowance to 0 to revoke it. A
              delegated transfer requires the owner’s allowance to your
              connected account. Hook callbacks can only be called by the
              PoolManager, through a swap.
            </p>
            <form onSubmit={tokenAction}>
              <fieldset disabled={!!busy}>
                <legend>Manage {symbol}</legend>
                <div className="tool-grid">
                  <label>
                    Action
                    <select
                      aria-label="Action"
                      name="tokenAction"
                      autoComplete="off"
                      value={mode}
                      onChange={(e) => {
                        setMode(e.target.value);
                        setAllowanceInfo("");
                      }}
                    >
                      <option value="transfer">Transfer NOOP</option>
                      <option value="approve">Set / Revoke Allowance</option>
                      <option value="transferFrom">Delegated Transfer</option>
                    </select>
                  </label>
                  {mode === "transferFrom" && (
                    <label>
                      Token Owner
                      <input
                        name="owner"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="0x…"
                        value={owner}
                        onChange={(e) => setOwner(e.target.value)}
                      />
                    </label>
                  )}
                  <label>
                    {mode === "approve"
                      ? "Spender Address"
                      : "Recipient Address"}
                    <input
                      name="recipient"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="0x…"
                      value={recipient}
                      onChange={(e) => {
                        setRecipient(e.target.value);
                        setAllowanceInfo("");
                      }}
                    />
                  </label>
                  <label>
                    Amount ({symbol})
                    <input
                      name="tokenAmount"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00…"
                      value={tokenAmount}
                      onChange={(e) => setTokenAmount(e.target.value)}
                    />
                  </label>
                </div>
                <p className="hint">
                  {mode === "approve"
                    ? `Allow ${recipient || "the spender"} to spend up to ${tokenAmount || "0"} ${symbol} from your wallet. This replaces the existing allowance.`
                    : `Send ${tokenAmount || "0"} ${symbol} ${mode === "transferFrom" ? `from ${owner || "the owner"}` : "from your wallet"} to ${recipient || "the recipient"}. Confirm the full address before signing.`}
                </p>
                {error && errorArea === "token" && (
                  <p className="inline-error" role="alert">
                    {error}
                  </p>
                )}
                <button type="submit" disabled={!ready}>
                  Simulate & {mode === "approve" ? "Set Allowance" : "Transfer"}
                </button>
                {mode === "approve" && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={!ready}
                    onClick={() =>
                      void task("Reading allowance…", async () => {
                        if (!isAddress(recipient) || !account)
                          throw Error("Enter a valid spender address.");
                        const value = await client.readContract({
                          address: token.address,
                          abi: token.abi,
                          functionName: "allowance",
                          args: [account, recipient],
                        });
                        setAllowanceInfo(
                          `Current allowance: ${formatUnits(value as bigint, config.manifest.token.decimals)} ${symbol}`,
                        );
                      })
                    }
                  >
                    Read Allowance
                  </button>
                )}
                <p role="status">{allowanceInfo}</p>
              </fieldset>
            </form>
          </details>
        </section>
      </main>
      <footer className="shell">
        <span className="brand">◯ NOOP</span>
        <p>A small experiment in doing nothing.</p>
        <span>{config.network.name} · Test assets only</span>
      </footer>
    </>
  );
}
