import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";
import { ABI, FACTORY_ABI } from "./contract";
import "./dashboard.css";


const FACTORY_ADDRESS = (import.meta.env.VITE_RENTRA_FACTORY_ADDRESS || "").trim();
const PAGE_SIZE = 8;

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}
function eth(value) {
  try { return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 5 }); }
  catch { return "0"; }
}

export default function RentraApp() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState("");
  const [contract, setContract] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [factory, setFactory] = useState(null);
  const [selectedListing, setSelectedListing] = useState(null);
  const [pageMode, setPageMode] = useState("market");
  const [returnPageMode, setReturnPageMode] = useState("market");
  const [currentPage, setCurrentPage] = useState(1);
  const [isOwner, setIsOwner] = useState(false);
  const [status, setStatus] = useState("Connect MetaMask to begin.");
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState(null);
  const [listingData, setListingData] = useState([]);
  const [amount, setAmount] = useState("100");
  const [depositAmount, setDepositAmount] = useState("0.05");
  const [propertyName, setPropertyName] = useState("Orchard Residences");
  const [description, setDescription] = useState("Defined rights to eligible rental proceeds for an agreed financing term.");
  const [targetEth, setTargetEth] = useState("4");
  const [tokenCount, setTokenCount] = useState("4000");
  const [termYears, setTermYears] = useState("5");
  const [fundingEndDate, setFundingEndDate] = useState(""); // optional datetime-local; empty = no deadline
  const [monthlyIncomeEth, setMonthlyIncomeEth] = useState(""); // projected monthly rental income
  const [totalIncomeEth, setTotalIncomeEth] = useState(""); // projected total rental income over term
  const [resaleAmount, setResaleAmount] = useState("");   // tokens to list for resale
  const [resalePriceEth, setResalePriceEth] = useState(""); // total resale price (ETH)
  const [marketListings, setMarketListings] = useState([]); // active resale lots on this listing
  const [mySale, setMySale] = useState(null); // the connected wallet's own active listing

  const refresh = useCallback(() => setRefreshKey((x) => x + 1), []);

  // Load the factory (read-only) and the listings it tracks whenever the wallet/refresh changes.
  useEffect(() => {
    let cancelled = false;
    async function loadFactory() {
      if (!window.ethereum || !FACTORY_ADDRESS) return;
      try {
        const provider = new BrowserProvider(window.ethereum);
        let runner = provider;
        if (account) {
          try { runner = await provider.getSigner(); } catch { runner = provider; }
        }
        const factoryInstance = new Contract(FACTORY_ADDRESS, FACTORY_ABI, runner);
        const addresses = await factoryInstance.getAllOfferings();
        if (cancelled) return;
        setFactory(factoryInstance);
        setContracts(addresses.map((address) => new Contract(address, ABI, runner)));
      } catch (error) {
        if (!cancelled) setStatus(error.shortMessage || error.message || "Could not load listings from the factory.");
      }
    }
    loadFactory();
    return () => { cancelled = true; };
  }, [account, refreshKey]);

  const connect = async () => {
    if (!window.ethereum) {
      setStatus("MetaMask was not detected. Install the MetaMask browser extension and refresh.");
      return;
    }
    try {
      const provider = new BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const network = await provider.getNetwork();
      const chain = network.chainId.toString();
      setAccount(address);
      setChainId(chain);
      if (!FACTORY_ADDRESS) {
        setStatus("Wallet connected. Add the factory address to frontend/.env (VITE_RENTRA_FACTORY_ADDRESS) and restart Vite.");
        return;
      }
      // Contract instances and owner checks are refreshed by the effects keyed on `account`.
      setStatus(chain === "31337"
        ? "Wallet connected."
        : `Wallet connected to chain ID ${chain}.`);
    } catch (error) {
      setStatus(error.shortMessage || error.message || "Wallet connection failed.");
    }
  };

  useEffect(() => {
    if (!contracts.length) return;
    if (selectedListing === null) {
      setContract(null);
      setData(null);
      setIsOwner(false);
      return;
    }
    const instance = contracts[selectedListing];
    if (!instance) return;
    setContract(instance);
    setData(null);
    if (account) instance.owner().then((owner) => setIsOwner(owner.toLowerCase() === account.toLowerCase())).catch(() => setIsOwner(false));
    else setIsOwner(false);
  }, [contracts, selectedListing, account]);

  useEffect(() => {
    if (!window.ethereum) return;
    const onAccounts = () => window.location.reload();
    const onChain = () => window.location.reload();
    window.ethereum.on?.("accountsChanged", onAccounts);
    window.ethereum.on?.("chainChanged", onChain);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccounts);
      window.ethereum.removeListener?.("chainChanged", onChain);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!contract) return;
      const holder = account || "0x0000000000000000000000000000000000000000";
      try {
        const [
          offeringCreated, property, details, price, target, supply, sold, closed,
          balance, claimable, deposited, claimed, raised, capitalTransferred, withdrawn,
          startDate, maturityDate, investorShareBps, ownerRentalTransferred, fundingDeadline
        ] = await Promise.all([
          contract.offeringCreated(), contract.propertyName(), contract.description(),
          contract.tokenPriceWei(), contract.fundingTargetWei(), contract.tokenSupply(), contract.tokensSold(),
          contract.fundingClosed(), contract.balanceOf(holder), contract.claimable(holder),
          contract.totalRentalDeposited(), contract.totalRentalClaimed(),
          contract.totalRaised(), contract.totalCapitalTransferredToOwner(), contract.capitalWithdrawn(),
          contract.startDate(), contract.maturityDate(), contract.investorShareBps(), contract.totalRentalTransferredToOwner(),
          contract.fundingDeadline()
        ]);
        const [projectedMonthly, projectedTotal] = await Promise.all([
          contract.projectedMonthlyIncomeWei(), contract.projectedTotalIncomeWei()
        ]);
        // The latest rental deposit represents "this month's" rental income for the listing.
        let lastDeposit = 0n;
        try {
          const events = await contract.queryFilter(contract.filters.RentalIncomeDeposited());
          if (events.length) lastDeposit = events[events.length - 1].args.grossAmount;
        } catch { /* event history unavailable; leave as zero */ }

        // Total this investor has actually claimed = sum of their DistributionClaimed events.
        let myClaimedTotal = 0n;
        if (account) {
          try {
            const claims = await contract.queryFilter(contract.filters.DistributionClaimed(account));
            myClaimedTotal = claims.reduce((sum, event) => sum + event.args.amount, 0n);
          } catch { /* event history unavailable; leave as zero */ }
        }

        if (!cancelled) setData({
          offeringCreated, property, details, price, target, supply, sold, closed,
          balance, claimable, deposited, claimed, raised, capitalTransferred, withdrawn,
          startDate, maturityDate, investorShareBps, ownerRentalTransferred, lastDeposit, myClaimedTotal,
          fundingDeadline, projectedMonthly, projectedTotal
        });
      } catch (error) {
        if (!cancelled) setStatus(error.shortMessage || error.message || "Could not read contract state.");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [contract, account, refreshKey]);

  // Load active secondary-market (resale) listings for the selected offering.
  useEffect(() => {
    let cancelled = false;
    async function loadMarket() {
      if (!contract) { setMarketListings([]); setMySale(null); return; }
      try {
        // Candidate sellers = everyone who ever listed. Verify each against current on-chain state.
        const listedEvents = await contract.queryFilter(contract.filters.SaleListed());
        const sellers = [...new Set(listedEvents.map((e) => e.args.seller))];
        const results = await Promise.all(sellers.map(async (seller) => {
          const sale = await contract.saleOf(seller);
          return { seller, amount: sale.amount, priceWei: sale.priceWei };
        }));
        const active = results.filter((r) => r.amount > 0n);
        if (cancelled) return;
        const mine = account ? active.find((r) => r.seller.toLowerCase() === account.toLowerCase()) : null;
        setMySale(mine || null);
        setMarketListings(active);
      } catch (error) {
        if (!cancelled) { setMarketListings([]); setMySale(null); }
      }
    }
    loadMarket();
    return () => { cancelled = true; };
  }, [contract, account, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadListings() {
      if (!contracts.length) return;
      try {
        const rows = await Promise.all(contracts.map(async (instance, index) => {
          const holder = account || "0x0000000000000000000000000000000000000000";
          const [created, property, details, target, supply, sold, closed, maturityDate, owner, investorBalance, claimable] = await Promise.all([
            instance.offeringCreated(), instance.propertyName(), instance.description(), instance.fundingTargetWei(),
            instance.tokenSupply(), instance.tokensSold(), instance.fundingClosed(), instance.maturityDate(), instance.owner(),
            instance.balanceOf(holder), instance.claimable(holder)
          ]);
          return { index, created, property: property || `Listing ${index + 1}`, details: details || "Rental income opportunity", target, supply, sold, closed, maturityDate, owner, investorBalance, claimable };
        }));
        if (!cancelled) setListingData(rows);
      } catch (error) {
        if (!cancelled) setStatus(error.shortMessage || error.message || "Could not load listings.");
      }
    }
    loadListings();
    return () => { cancelled = true; };
  }, [contracts, account, refreshKey]);

  const fundingPercent = useMemo(() => {
    if (!data || data.supply === 0n) return 0;
    return Math.min(100, Number((data.sold * 10000n) / data.supply) / 100);
  }, [data]);

  // The investor's share of rental income equals their tokens / total supply.
  const holdingPercent = useMemo(() => {
    if (!data || data.supply === 0n) return 0;
    return Number((data.balance * 1000000n) / data.supply) / 10000;
  }, [data]);

  // Rental income you have actually received = sum of your on-chain DistributionClaimed events.
  const receivedToDateEth = useMemo(() => (data ? data.myClaimedTotal ?? 0n : 0n), [data]);

  // Your share of the most recent ("this month's") rental deposit.
  const myMonthlyShareEth = useMemo(() => {
    if (!data || data.supply === 0n) return 0n;
    return (data.lastDeposit * data.balance) / data.supply;
  }, [data]);

  // Whether the optional funding deadline has passed (0 = no deadline set).
  const deadlinePassed = useMemo(() => {
    if (!data || !data.fundingDeadline || data.fundingDeadline === 0n) return false;
    return BigInt(Math.floor(Date.now() / 1000)) >= data.fundingDeadline;
  }, [data]);

  // Projected ROI over the term: (projected total income − funding target) / funding target.
  const projectedRoi = useMemo(() => {
    if (!data || data.target === 0n || data.projectedTotal === 0n) return null;
    return Number(((data.projectedTotal - data.target) * 10000n) / data.target) / 100;
  }, [data]);

  const visibleListings = useMemo(() => {
    let rows = listingData.filter((listing) => listing.created);
    if (pageMode === "my-listings") rows = rows.filter((listing) => account && listing.owner.toLowerCase() === account.toLowerCase());
    if (pageMode === "my-investments") rows = rows.filter((listing) => listing.investorBalance > 0n);
    return rows;
  }, [listingData, pageMode, account]);
  const pageCount = Math.max(1, Math.ceil(visibleListings.length / PAGE_SIZE));
  const pageListings = visibleListings.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const firstVisible = visibleListings.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const lastVisible = Math.min(currentPage * PAGE_SIZE, visibleListings.length);

  function navigateTo(mode) {
    setPageMode(mode);
    setSelectedListing(null);
    setCurrentPage(1);
  }

  async function startNewListing() {
    if (!factory) return setStatus("Connect your wallet before adding a listing.");
    if (!account) return setStatus("Connect your wallet before adding a listing.");
    setBusy(true);
    setStatus("Add listing: deploying a new offering. Confirm in MetaMask…");
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const factorySigner = new Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
      const tx = await factorySigner.createListing();
      setStatus("Add listing: deployment submitted. Waiting for confirmation…");
      const receipt = await tx.wait();

      // Find the new offering's address and index from the ListingDeployed event.
      let newIndex = contracts.length;
      for (const log of receipt.logs) {
        try {
          const parsed = factorySigner.interface.parseLog(log);
          if (parsed && parsed.name === "ListingDeployed") {
            newIndex = Number(parsed.args.index);
            break;
          }
        } catch { /* not a factory event */ }
      }

      // Refresh the on-chain listing set, then open the new listing's owner form.
      refresh();
      setSelectedListing(newIndex);
      setPageMode("detail");
      setPropertyName("");
      setDescription("Defined rights to eligible rental proceeds for an agreed financing term.");
      setTargetEth("1");
      setTokenCount("1000");
      setTermYears("5");
      setStatus("Add listing: offering deployed. Fill in the terms below and publish.");
    } catch (error) {
      setStatus(error.shortMessage || error.reason || error.message || "Add listing failed.");
    } finally {
      setBusy(false);
    }
  }

  async function act(label, callback) {
    setBusy(true);
    setStatus(`${label}: waiting for MetaMask confirmation…`);
    try {
      const tx = await callback();
      setStatus(`${label}: transaction submitted. Waiting for confirmation…`);
      await tx.wait();
      setStatus(`${label}: confirmed on the blockchain.`);
      refresh();
    } catch (error) {
      setStatus(error.shortMessage || error.reason || error.message || `${label} failed.`);
    } finally {
      setBusy(false);
    }
  }

  const create = () => {
    let target;
    try { target = parseEther(targetEth); } catch { return setStatus("Enter a valid ETH funding target."); }
    const supply = BigInt(tokenCount);
    const years = BigInt(termYears);
    if (supply <= 0n || years <= 0n || target <= 0n) return setStatus("Target, token count, and term must be positive.");
    if (target % supply !== 0n) return setStatus("Funding target must divide evenly across the token count.");
    const start = BigInt(Math.floor(Date.now() / 1000) + 60);
    const maturity = start + years * 365n * 24n * 60n * 60n;
    // Optional funding deadline: 0 = none. Must be in the future and on/before maturity.
    let deadline = 0n;
    if (fundingEndDate) {
      const seconds = Math.floor(new Date(fundingEndDate).getTime() / 1000);
      if (!Number.isFinite(seconds) || seconds <= 0) return setStatus("Enter a valid funding end date or leave it blank.");
      deadline = BigInt(seconds);
      if (deadline <= start) return setStatus("Funding end date must be in the future.");
      if (deadline > maturity) return setStatus("Funding end date must be on or before the maturity date.");
    }
    // Optional projected figures (informational). Blank = 0.
    let monthly = 0n;
    let totalIncome = 0n;
    if (monthlyIncomeEth) {
      try { monthly = parseEther(monthlyIncomeEth); } catch { return setStatus("Enter a valid projected monthly rental income or leave it blank."); }
    }
    if (totalIncomeEth) {
      try { totalIncome = parseEther(totalIncomeEth); } catch { return setStatus("Enter a valid projected total rental income or leave it blank."); }
    }
    if (monthly > 0n && totalIncome > 0n && totalIncome < monthly) {
      return setStatus("Projected total income should be at least one month's income.");
    }
    const fallbackName = `New Listing ${selectedListing + 1}`;
    if (!propertyName.trim()) return setStatus("Enter a property / offering name.");
    return act("Create offering", () => contract.createOffering(propertyName || fallbackName, description, supply, target, start, maturity, deadline, monthly, totalIncome));
  };
  const buy = () => {
    const n = BigInt(amount);
    if (n <= 0n) return setStatus("Enter a positive whole number of tokens.");
    return act("Purchase tokens", () => contract.buyTokens(n, { value: data.price * n }));
  };
  const close = () => act("Close funding", () => contract.closeFunding());
  const withdrawCapital = () => act("Transfer raised capital", () => contract.withdrawRaisedCapital());
  const recoverUnclaimed = () => act("Recover unclaimed rental at maturity", () => contract.transferUnclaimedRentalToOwner());
  const deposit = () => {
    let value;
    try { value = parseEther(depositAmount); } catch { return setStatus("Enter a valid ETH amount."); }
    if (value <= 0n) return setStatus("Deposit must be greater than zero.");
    return act("Credit this month's rental income", () => contract.depositRentalIncome({ value }));
  };
  const claim = () => act("Claim distribution", () => contract.claimDistribution());

  const listResale = () => {
    if (!data) return;
    let amount;
    try { amount = BigInt(resaleAmount); } catch { return setStatus("Enter a whole number of tokens to sell."); }
    if (amount <= 0n) return setStatus("Enter a positive number of tokens to sell.");
    if (amount > data.balance) return setStatus("You cannot list more tokens than you hold.");
    let price;
    try { price = parseEther(resalePriceEth); } catch { return setStatus("Enter a valid total resale price in ETH."); }
    if (price <= 0n) return setStatus("Resale price must be greater than zero.");
    return act("List tokens for resale", () => contract.listForSale(amount, price));
  };
  const cancelResale = () => act("Cancel resale listing", () => contract.cancelSale());
  const buyResale = (seller, priceWei) => act("Buy resale lot", () => contract.buyResale(seller, { value: priceWei }));

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-mark">R</span><span>rentra<span className="brand-dot">.</span><small>RENTAL INCOME, REIMAGINED</small></span></a>
        <nav className="primary-nav" aria-label="Account pages">
          <button className={pageMode === "market" ? "active" : ""} onClick={() => navigateTo("market")}>Opportunities</button>
          <button className={pageMode === "my-listings" ? "active" : ""} onClick={() => navigateTo("my-listings")}>My listings</button>
          <button className={pageMode === "my-investments" ? "active" : ""} onClick={() => navigateTo("my-investments")}>My investments</button>
        </nav>
        <div className="top-actions">
          <span className={`network-pill ${chainId === "31337" ? "good" : ""}`}><span className="dot"/> {chainId ? `Connected · ${chainId}` : "Wallet not connected"}</span>
          <button className="wallet-button" onClick={connect}>{account ? shortAddress(account) : "Connect wallet"}</button>
        </div>
      </header>

      <main>
        {pageMode !== "detail" && <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span/> THE FUTURE OF PROPERTY FINANCING</div>
            <h1>Unlock property value.<br/><em>Keep ownership.</em></h1>
            <p>Access fractional exposure to defined rental-income rights — with transparent, blockchain-based records.</p>
            <div className="hero-note"><span className="shield">✓</span> Rental income financing · Property ownership retained</div>
          </div>
          <div className="hero-art" aria-label="Abstract building illustration">
            <div className="sun"/>
            <div className="building building-back"><i/><i/><i/><i/></div>
            <div className="building building-front"><i/><i/><i/><i/><i/><i/></div>
            <div className="art-caption"><span>01 / RENTAL INCOME</span><b>Real estate, reimagined.</b></div>
          </div>
        </section>}

        {pageMode !== "detail" && <>
        <section className="section-heading listings-heading">
          <div><div className="eyebrow muted">RENTAL INCOME OPPORTUNITIES</div><h2>{pageMode === "my-listings" ? "My listings" : pageMode === "my-investments" ? "My investments" : "Available listings"}</h2></div>
          <div className="list-heading-actions">
            <span className="live-label"><span/> {visibleListings.length} LISTINGS</span>
            {account && pageMode !== "my-investments" && <button className="primary-button add-listing-button" disabled={busy} onClick={startNewListing}>+ Add listing</button>}
          </div>
        </section>

        <section className="listing-list" aria-label="Available listings">
          {pageListings.map((listing) => (
            <button key={listing.index} className={`listing-summary panel ${selectedListing === listing.index ? "selected" : ""}`} onClick={() => {
              setReturnPageMode(pageMode);
              setPageMode("detail");
              setSelectedListing(listing.index);
              setPropertyName(listing.property);
              setDescription(listing.details);
              setTargetEth(formatEther(listing.target));
              setTokenCount(listing.supply.toString());
            }}>
              <span className="listing-summary-main"><b>{listing.property}</b><small>{listing.details}</small></span>
              <span className="listing-summary-metric"><small>Target</small><b>{eth(listing.target)} ETH</b></span>
              <span className="listing-summary-metric"><small>Tokens</small><b>{listing.supply.toLocaleString()}</b></span>
              <span className="listing-summary-metric"><small>Funding</small><b>{listing.closed ? "Closed" : "Open"}</b></span>
              <span className="listing-summary-arrow">›</span>
            </button>
          ))}
          {!visibleListings.length && <div className="empty-state panel"><h3>{pageMode === "my-investments" ? "No investments yet" : pageMode === "my-listings" ? "You have no listings yet" : "No published listings available"}</h3><p>{pageMode === "my-investments" ? "Your rental income investments will appear here." : pageMode === "my-listings" ? "Listings you publish will appear here." : "Connect the owner wallet to prepare an offering."}</p></div>}
        </section>
        <section className="pagination-bar" aria-label="Listing pages">
          <span>Showing {firstVisible}–{lastVisible} of {visibleListings.length}</span>
          <div><button className="secondary-button" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>Previous</button><span>Page {currentPage} of {pageCount}</span><button className="secondary-button" disabled={currentPage >= pageCount} onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}>Next</button></div>
        </section>
        </>}

        {selectedListing !== null && <>
        <section className="section-heading detail-heading">
          <div><div className="eyebrow muted">LISTING DETAILS</div><h2>{data?.property || "Offering details"}</h2></div>
          <button className="back-button" onClick={() => { setSelectedListing(null); setPageMode(returnPageMode); }}>← Back to listings</button>
        </section>

        {!data ? (
          <section className="empty-state panel"><p>Loading offering details…</p></section>
        ) : !data.offeringCreated ? (
          <section className="empty-state panel">
            <div className="empty-icon">⌂</div>
            <h3>No offering has been created yet</h3>
            <p>{isOwner ? "Fill in the offering terms in the owner dashboard below and publish to open this listing for subscription." : "Offering terms are being prepared. This listing isn't open for subscription yet."}</p>
          </section>
        ) : (
          <section className="offering-card panel">
            <div className="property-art"><div className="property-sun"/><div className="property-building"><i/><i/><i/><i/><i/><i/><i/><i/></div><span className="property-tag">RENTAL INCOME RIGHTS</span></div>
            <div className="offering-details">
              <div className="offering-top"><span className="status-tag"><span/> {data.closed ? "FUNDING CLOSED" : deadlinePassed ? "FUNDING ENDED" : "OPEN FOR SUBSCRIPTION"}</span><span className="asset-code">RENTRA · LISTING 00{selectedListing + 1}</span></div>
              <h3>{data.property}</h3>
              <p className="subtext">{data.details}</p>
              <div className="metrics">
                <div><small>Funding target</small><strong>{eth(data.target)} <small>ETH*</small></strong></div>
                <div><small>Token price</small><strong>{eth(data.price)} <small>ETH</small></strong></div>
                <div><small>Tokens sold</small><strong>{data.sold.toString()} <small>/ {data.supply.toString()}</small></strong></div>
              </div>
              <div className="row-data"><span>Financing term</span><b>{new Date(Number(data.startDate) * 1000).toLocaleDateString()} – {new Date(Number(data.maturityDate) * 1000).toLocaleDateString()}</b></div>
              <div className="row-data"><span>Funding closes</span><b>{data.fundingDeadline && data.fundingDeadline !== 0n ? new Date(Number(data.fundingDeadline) * 1000).toLocaleString() : "No set deadline"}</b></div>
              <div className="progress-head"><span>Funding progress</span><b>{fundingPercent.toFixed(2)}%</b></div>
              <div className="progress-track"><div style={{ width: `${fundingPercent}%` }}/></div>

              {(data.projectedMonthly > 0n || data.projectedTotal > 0n) && (
                <div className="projection-card">
                  <div className="projection-head"><span className="eyebrow muted">EXPECTED RETURN (PROJECTED)</span>{projectedRoi !== null && <span className="roi-pill">{projectedRoi.toFixed(1)}% ROI over term</span>}</div>
                  <div className="stat-grid projection-grid">
                    <div><small>Projected monthly income</small><strong>{eth(data.projectedMonthly)} ETH</strong></div>
                    <div><small>Projected total over term</small><strong>{eth(data.projectedTotal)} ETH</strong></div>
                  </div>
                  <p className="fine-print">Projected figures are the owner's estimates, not guarantees. Actual income depends on the rental payments deposited during the term.</p>
                </div>
              )}

              {isOwner ? (
                <p className="fine-print">You own this listing. Owners manage the offering from the owner dashboard below and cannot subscribe to their own tokens.</p>
              ) : (
                <>
                  <div className="offering-actions">
                    <label>Tokens to purchase<input type="number" min="1" step="1" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy || data.closed || deadlinePassed}/></label>
                    <button className="primary-button" disabled={!contract || busy || data.closed || deadlinePassed || !account || !data.offeringCreated} onClick={buy}>{busy ? "Processing…" : deadlinePassed ? "Funding ended" : "Buy tokens ↗"}</button>
                  </div>
                  <p className="fine-print">{deadlinePassed ? "The funding deadline for this listing has passed, so new purchases are closed." : "Subscriptions are completed through the connected wallet. Tokens represent rights to the offering’s defined rental-income stream, not ownership of the property."}</p>
                </>
              )}
            </div>
          </section>
        )}

        <section className="dashboard-role-note info-box neutral centered">
          {!account
            ? "Connect your wallet to buy tokens or manage a listing you own."
            : isOwner
              ? "You own this listing. The owner dashboard below lets you manage the offering."
              : "You're viewing this as an investor. Buy tokens above, then track and claim your rental income below."}
        </section>
        {!isOwner ? <section className="investor-view">
          <div className="panel dashboard-panel">
            <div className="panel-title"><div><span className="eyebrow muted">YOUR POSITION</span><h3>Investor dashboard</h3></div><span className="round-icon">↗</span></div>

            <div className="investor-headline">
              <div className="position-value">{data ? data.balance.toString() : "—"} <span>RENT units</span></div>
              <div className="holding-share">
                <small>Your share of rental income</small>
                <strong>{data ? holdingPercent.toFixed(2) : "—"}%</strong>
              </div>
            </div>
            <p className="subtext">{data ? `${data.balance.toString()} of ${data.supply.toString()} tokens — you receive ${holdingPercent.toFixed(2)}% of every rental distribution.` : "Units held by the connected wallet"}</p>
            <div className="holding-track"><div style={{ width: `${Math.min(100, holdingPercent)}%` }}/></div>

            <div className="divider"/>

            <div className="stat-grid investor-stats">
              <div><small>Your tokens</small><strong>{data ? data.balance.toString() : "—"}</strong></div>
              <div><small>Total supply</small><strong>{data ? data.supply.toString() : "—"}</strong></div>
              <div><small>Income share</small><strong>{data ? holdingPercent.toFixed(2) : "—"}%</strong></div>
            </div>

            <div className="investor-rows-label">This month</div>
            <div className="row-data"><span>This month's rental income</span><b>{data ? eth(data.lastDeposit) : "—"} ETH</b></div>
            <div className="row-data"><span>My share this month ({data ? holdingPercent.toFixed(2) : "—"}%)</span><b>{data ? eth(myMonthlyShareEth) : "—"} ETH</b></div>

            <div className="investor-rows-label">To date</div>
            <div className="row-data"><span>Total rental income received by owner</span><b>{data ? eth(data.deposited) : "—"} ETH</b></div>
            <div className="row-data"><span>Total rental income I've received</span><b>{data ? eth(receivedToDateEth) : "—"} ETH</b></div>
            <div className="row-data"><span>Rental income I can claim now</span><b>{data ? eth(data.claimable) : "—"} ETH</b></div>

            <button className="secondary-button full" disabled={!contract || busy || !data || data.claimable === 0n} onClick={claim}>Claim rental income</button>
            <p className="fine-print">Each month the owner credits that month's rental income, split across investors by token share. You earn {data ? holdingPercent.toFixed(2) : "—"}% ({data ? data.balance.toString() : "—"} of {data ? data.supply.toString() : "—"} tokens). Your share accrues automatically; claim it to your wallet before maturity.</p>
          </div>

          {data?.offeringCreated && (
            <div className="panel dashboard-panel secondary-market">
              <div className="panel-title"><div><span className="eyebrow muted">SECONDARY MARKET</span><h3>Resell &amp; buy tokens</h3></div><span className="round-icon">⇄</span></div>
              <p className="subtext">Trade rental-income tokens with other investors before maturity. The seller keeps rental accrued up to the sale; the buyer earns from deposits made afterwards.</p>

              <div className="divider"/>

              {/* Your own listing / list form */}
              <div className="investor-rows-label">Sell your tokens</div>
              {mySale ? (
                <>
                  <div className="row-data"><span>Your active listing</span><b>{mySale.amount.toString()} tokens for {eth(mySale.priceWei)} ETH</b></div>
                  <button className="secondary-button full" disabled={!account || busy} onClick={cancelResale}>Cancel listing</button>
                </>
              ) : (
                <>
                  <div className="market-form">
                    <label>Tokens to sell<input type="number" min="1" step="1" value={resaleAmount} onChange={e => setResaleAmount(e.target.value)} disabled={!account || busy || !data || data.balance === 0n}/></label>
                    <label>Total price (ETH)<input type="number" min="0" step="0.01" value={resalePriceEth} onChange={e => setResalePriceEth(e.target.value)} disabled={!account || busy || !data || data.balance === 0n}/></label>
                  </div>
                  <button className="secondary-button full" disabled={!account || busy || !data || data.balance === 0n} onClick={listResale}>List for resale</button>
                  {data && data.balance === 0n && <p className="fine-print">You need to hold tokens in this listing before you can sell any.</p>}
                </>
              )}

              {/* Other sellers' listings */}
              <div className="investor-rows-label">Buy from other investors</div>
              {marketListings.filter((l) => !account || l.seller.toLowerCase() !== account.toLowerCase()).length === 0 ? (
                <p className="fine-print">No tokens are currently listed for resale by other investors.</p>
              ) : (
                marketListings
                  .filter((l) => !account || l.seller.toLowerCase() !== account.toLowerCase())
                  .map((l) => (
                    <div key={l.seller} className="market-lot">
                      <div className="market-lot-info">
                        <b>{l.amount.toString()} tokens</b>
                        <small>{shortAddress(l.seller)} · {eth(l.priceWei)} ETH total</small>
                      </div>
                      <button className="primary-button" disabled={!account || busy} onClick={() => buyResale(l.seller, l.priceWei)}>Buy ↗</button>
                    </div>
                  ))
              )}
            </div>
          )}
        </section> : <section className="owner-view">
          <div className="panel dashboard-panel">
            <div className="panel-title"><div><span className="eyebrow muted">OFFERING CONTROLS</span><h3>Owner dashboard</h3></div><span className="round-icon">⌘</span></div>
            <div className="info-box neutral owner-banner">Owner wallet connected · you manage this listing</div>
            {!data?.offeringCreated && (
              <div className="form-stack">
                <label>Property / offering name<input value={propertyName} onChange={e => setPropertyName(e.target.value)}/></label>
                <label>Offering description<textarea value={description} onChange={e => setDescription(e.target.value)} rows="2"/></label>
                <label>Funding target (ETH)<input type="number" min="0.000000000000000001" step="0.1" value={targetEth} onChange={e => setTargetEth(e.target.value)}/></label>
                <label>Number of tokens<input type="number" min="1" step="1" value={tokenCount} onChange={e => setTokenCount(e.target.value)}/></label>
                <label>Financing term (years)<input type="number" min="1" step="1" value={termYears} onChange={e => setTermYears(e.target.value)}/></label>
                <label>Funding end date (optional)<input type="datetime-local" value={fundingEndDate} onChange={e => setFundingEndDate(e.target.value)}/></label>
                <label>Projected monthly rental income (ETH)<input type="number" min="0" step="0.01" value={monthlyIncomeEth} onChange={e => setMonthlyIncomeEth(e.target.value)} placeholder="e.g. 0.08"/></label>
                <label>Projected total rental income over the term (ETH)<input type="number" min="0" step="0.1" value={totalIncomeEth} onChange={e => setTotalIncomeEth(e.target.value)} placeholder="e.g. 5"/></label>
                {totalIncomeEth && targetEth && Number(targetEth) > 0 && (
                  <div className="info-box accent">Investors will see an expected term ROI of about <b>{(((Number(totalIncomeEth) - Number(targetEth)) / Number(targetEth)) * 100).toFixed(1)}%</b> based on these figures.</div>
                )}
                <p className="fine-print">The target is divided evenly across the token supply and sets the token price. The projected monthly and total rental income are your estimates shown to investors so they can gauge expected return — they are not guarantees. Actual payouts come only from the rental income you deposit during the term. A funding end date is optional.</p>
                <button className="primary-button full" disabled={busy} onClick={create}>Publish offering</button>
              </div>
            )}
            {data?.offeringCreated && (
              <div className="form-stack">
                <div className="row-data"><span>Funding status</span><b>{data.closed ? "Closed" : "Open"}</b></div>
                <div className="row-data"><span>Total raised</span><b>{eth(data.raised)} ETH</b></div>
                <div className="row-data"><span>Capital transferred to owner</span><b>{eth(data.capitalTransferred)} ETH</b></div>
                {!data.closed && <button className="secondary-button full" disabled={!isOwner || busy || data.sold === 0n} onClick={close}>Close funding early</button>}
                {!data.closed && <p className="fine-print">Funding closes on its own once every token is sold. Close early only if you want to stop sales before then — this is also required before withdrawing the raised capital.</p>}
                {data.closed && !data.withdrawn && <button className="secondary-button full" disabled={!isOwner || busy} onClick={withdrawCapital}>Transfer raised capital to owner</button>}
                <label>This month's rental income to distribute (ETH)<input type="number" min="0.000000000000000001" step="0.01" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} disabled={data.sold === 0n}/></label>
                <button className="primary-button full" disabled={!isOwner || busy || data.sold === 0n || BigInt(Math.floor(Date.now() / 1000)) < data.startDate || BigInt(Math.floor(Date.now() / 1000)) >= data.maturityDate} onClick={deposit}>Credit this month's rental income to investors</button>
                <p className="fine-print">Enter the rental income collected this month. The contract splits it across investors by their token share, and each investor can then claim their portion. You can distribute income as soon as tokens have been bought — funding does not need to be closed first. In this demo you credit it on demand to simulate a monthly payout.</p>
                {BigInt(Math.floor(Date.now() / 1000)) >= (data.maturityDate || 0n) && <button className="secondary-button full" disabled={!isOwner || busy} onClick={recoverUnclaimed}>Transfer unclaimed rental to owner</button>}
              </div>
            )}
          </div>
        </section>}
        </>}

        {pageMode !== "detail" && <section className="company-section panel">
          <div className="eyebrow muted">ABOUT RENTRA</div>
          <h2>Financing through future rental income</h2>
          <p>Rentra is a real-estate fintech company focused on tokenising future rental-income rights. The platform is designed to help property owners access capital while retaining ownership, and give eligible investors fractional access to real-estate-linked income.</p>
          <div className="company-contact"><div><small>Chief Executive Officer</small><b>Daniel Tan</b></div><div><small>Media relations</small><b>Ong Zhi Hui · <a href="mailto:ongzh@rentra.com">ongzh@rentra.com</a></b></div></div>
        </section>}
        <footer><a className="brand footer-brand" href="#"><span className="brand-mark">R</span><span>rentra<span className="brand-dot">.</span><small>RENTAL INCOME FINANCING</small></span></a><span>Singapore · Real-estate finance</span></footer>
      </main>
      <div className="toast" role="status"><span className="toast-dot"/>{status}</div>
    </div>
  );
}
