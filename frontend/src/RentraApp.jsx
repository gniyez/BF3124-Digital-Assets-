import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";
import { ABI } from "./contract";
import "./dashboard.css";


const CONTRACT_ADDRESSES = (import.meta.env.VITE_RENTRA_CONTRACT_ADDRESSES || import.meta.env.VITE_RENTRA_CONTRACT_ADDRESS || "")
  .split(",").map((value) => value.trim()).filter(Boolean);
const LISTING_TEMPLATES = [
  { name: "Orchard Residences", description: "Residential rental income opportunity" },
  { name: "Harbourfront Lofts", description: "Mixed-use waterfront rental income opportunity" },
  { name: "Garden District Offices", description: "Commercial rental income opportunity" }
];
const LISTINGS = CONTRACT_ADDRESSES.length
  ? LISTING_TEMPLATES.slice(0, CONTRACT_ADDRESSES.length)
  : LISTING_TEMPLATES;
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
  const [selectedListing, setSelectedListing] = useState(null);
  const [pageMode, setPageMode] = useState("market");
  const [returnPageMode, setReturnPageMode] = useState("market");
  const [currentPage, setCurrentPage] = useState(1);
  const [dashboard, setDashboard] = useState("investor");
  const [isOwner, setIsOwner] = useState(false);
  const [isOwnerAny, setIsOwnerAny] = useState(false);
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

  const refresh = useCallback(() => setRefreshKey((x) => x + 1), []);

  useEffect(() => {
    if (!window.ethereum || !CONTRACT_ADDRESSES.length) return;
    const provider = new BrowserProvider(window.ethereum);
    setContracts(CONTRACT_ADDRESSES.map((address) => new Contract(address, ABI, provider)));
  }, []);

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
      if (!CONTRACT_ADDRESSES.length) {
        setStatus("Wallet connected. Add listing contract addresses to frontend/.env and restart Vite.");
        return;
      }
      const instances = CONTRACT_ADDRESSES.map((contractAddress) => new Contract(contractAddress, ABI, signer));
      setContracts(instances);
      const instance = instances[selectedListing ?? 0] || instances[0];
      setContract(selectedListing === null ? null : instance);
      const owners = await Promise.all(instances.map((item) => item.owner()));
      setIsOwnerAny(owners.some((owner) => owner.toLowerCase() === address.toLowerCase()));
      setIsOwner(instance && (await instance.owner()).toLowerCase() === address.toLowerCase());
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
          startDate, maturityDate, investorShareBps, ownerRentalTransferred
        ] = await Promise.all([
          contract.offeringCreated(), contract.propertyName(), contract.description(),
          contract.tokenPriceWei(), contract.fundingTargetWei(), contract.tokenSupply(), contract.tokensSold(),
          contract.fundingClosed(), contract.balanceOf(holder), contract.claimable(holder),
          contract.totalRentalDeposited(), contract.totalRentalClaimed(),
          contract.totalRaised(), contract.totalCapitalTransferredToOwner(), contract.capitalWithdrawn(),
          contract.startDate(), contract.maturityDate(), contract.investorShareBps(), contract.totalRentalTransferredToOwner()
        ]);
        if (!cancelled) setData({
          offeringCreated, property, details, price, target, supply, sold, closed,
          balance, claimable, deposited, claimed, raised, capitalTransferred, withdrawn,
          startDate, maturityDate, investorShareBps, ownerRentalTransferred
        });
      } catch (error) {
        if (!cancelled) setStatus(error.shortMessage || error.message || "Could not read contract state.");
      }
    }
    load();
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
          return { index, created, property: property || LISTINGS[index]?.name || `Listing ${index + 1}`, details: details || LISTINGS[index]?.description || "Rental income opportunity", target, supply, sold, closed, maturityDate, owner, investorBalance, claimable };
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

  function startNewListing() {
    const slot = listingData.find((listing) => !listing.created);
    if (!slot) return setStatus("All listing slots are in use. Increase deployment capacity to add another listing.");
    setSelectedListing(slot.index);
    setPageMode("detail");
    setDashboard("owner");
    setPropertyName(LISTINGS[slot.index]?.name || `New Listing ${slot.index + 1}`);
    setDescription(LISTINGS[slot.index]?.description || "Rental income opportunity");
    setTargetEth("1");
    setTokenCount("1000");
    setTermYears("5");
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
    const fallbackName = LISTINGS[selectedListing]?.name || `New Listing ${selectedListing + 1}`;
    return act("Create offering", () => contract.createOffering(propertyName || fallbackName, description, supply, target, start, maturity));
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
    return act("Record rental proceeds", () => contract.depositRentalIncome({ value }));
  };
  const claim = () => act("Claim distribution", () => contract.claimDistribution());

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
            {isOwnerAny && pageMode !== "my-investments" && <button className="primary-button add-listing-button" onClick={startNewListing}>+ Add listing</button>}
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
          <div><div className="eyebrow muted">LISTING DETAILS</div><h2>{data?.property || LISTINGS[selectedListing]?.name || "Offering details"}</h2></div>
          <button className="back-button" onClick={() => { setSelectedListing(null); setPageMode(returnPageMode); }}>← Back to listings</button>
        </section>

        {!data ? (
          <section className="empty-state panel"><p>Loading offering details…</p></section>
        ) : !data.offeringCreated ? (
          <section className="empty-state panel">
            <div className="empty-icon">⌂</div>
            <h3>No offering has been created yet</h3>
            <p>Offering terms are being prepared. Connect the authorized owner wallet to publish this listing.</p>
          </section>
        ) : (
          <section className="offering-card panel">
            <div className="property-art"><div className="property-sun"/><div className="property-building"><i/><i/><i/><i/><i/><i/><i/><i/></div><span className="property-tag">RENTAL INCOME RIGHTS</span></div>
            <div className="offering-details">
              <div className="offering-top"><span className="status-tag"><span/> {data.closed ? "FUNDING CLOSED" : "OPEN FOR SUBSCRIPTION"}</span><span className="asset-code">RENTRA · LISTING 00{selectedListing + 1}</span></div>
              <h3>{data.property}</h3>
              <p className="subtext">{data.details}</p>
              <div className="metrics">
                <div><small>Funding target</small><strong>{eth(data.target)} <small>ETH*</small></strong></div>
                <div><small>Token price</small><strong>{eth(data.price)} <small>ETH</small></strong></div>
                <div><small>Tokens sold</small><strong>{data.sold.toString()} <small>/ {data.supply.toString()}</small></strong></div>
              </div>
              <div className="row-data"><span>Financing term</span><b>{new Date(Number(data.startDate) * 1000).toLocaleDateString()} – {new Date(Number(data.maturityDate) * 1000).toLocaleDateString()}</b></div>
              <div className="progress-head"><span>Funding progress</span><b>{fundingPercent.toFixed(2)}%</b></div>
              <div className="progress-track"><div style={{ width: `${fundingPercent}%` }}/></div>
              <div className="offering-actions">
                <label>Tokens to purchase<input type="number" min="1" step="1" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy || data.closed}/></label>
                <button className="primary-button" disabled={!contract || busy || data.closed || !account || !data.offeringCreated} onClick={buy}>{busy ? "Processing…" : "Buy tokens ↗"}</button>
              </div>
              <p className="fine-print">Subscriptions are completed through the connected wallet. Tokens represent rights to the offering’s defined rental-income stream, not ownership of the property.</p>
            </div>
          </section>
        )}

        <section className="dashboard-tabs dashboard-tabs-detail" role="tablist" aria-label="Dashboard view">
          <button className={dashboard === "investor" ? "active" : ""} onClick={() => setDashboard("investor")}>Investor dashboard</button>
          <button className={dashboard === "owner" ? "active" : ""} onClick={() => setDashboard("owner")}>Owner dashboard</button>
        </section>
        {dashboard === "investor" ? <section className="dashboard-grid investor-view">
          <div className="panel dashboard-panel">
            <div className="panel-title"><div><span className="eyebrow muted">YOUR POSITION</span><h3>Investor dashboard</h3></div><span className="round-icon">↗</span></div>
            <div className="position-value">{data ? data.balance.toString() : "—"} <span>RENT units</span></div>
            <p className="subtext">Units held by the connected wallet</p>
            <div className="divider"/>
            <div className="row-data"><span>Claimable distribution</span><b>{data ? eth(data.claimable) : "—"} ETH</b></div>
            <div className="row-data"><span>Total rental income deposited</span><b>{data ? eth(data.deposited) : "—"} ETH</b></div>
            <button className="secondary-button full" disabled={!contract || busy || !data || data.claimable === 0n} onClick={claim}>Claim rental income</button>
          </div>
        </section> : <section className="owner-view">
          <div className="panel dashboard-panel">
            <div className="panel-title"><div><span className="eyebrow muted">OFFERING CONTROLS</span><h3>Owner dashboard</h3></div><span className="round-icon">⌘</span></div>
            <div className="owner-banner">{isOwner ? "Owner wallet connected · manages all three listings" : "Connect the contract owner wallet to manage the offering."}</div>
            {!data?.offeringCreated && isOwner && (
              <div className="form-stack">
                <label>Property / offering name<input value={propertyName} onChange={e => setPropertyName(e.target.value)}/></label>
                <label>Offering description<textarea value={description} onChange={e => setDescription(e.target.value)} rows="2"/></label>
                <label>Funding target (ETH)<input type="number" min="0.000000000000000001" step="0.1" value={targetEth} onChange={e => setTargetEth(e.target.value)}/></label>
                <label>Number of tokens<input type="number" min="1" step="1" value={tokenCount} onChange={e => setTokenCount(e.target.value)}/></label>
                <label>Financing term (years)<input type="number" min="1" step="1" value={termYears} onChange={e => setTermYears(e.target.value)}/></label>
                <p className="fine-print">The target is divided evenly across the token supply. All committed rental proceeds recorded for this offering are allocated by token holdings.</p>
                <button className="primary-button full" disabled={busy} onClick={create}>Publish offering</button>
              </div>
            )}
            {data?.offeringCreated && (
              <div className="form-stack">
                <div className="row-data"><span>Funding status</span><b>{data.closed ? "Closed" : "Open"}</b></div>
                <div className="row-data"><span>Total raised</span><b>{eth(data.raised)} ETH</b></div>
                <div className="row-data"><span>Capital transferred to owner</span><b>{eth(data.capitalTransferred)} ETH</b></div>
                {!data.closed && <button className="secondary-button full" disabled={!isOwner || busy || data.sold === 0n} onClick={close}>Close funding</button>}
                {data.closed && !data.withdrawn && <button className="secondary-button full" disabled={!isOwner || busy} onClick={withdrawCapital}>Transfer raised capital to owner</button>}
                <label>Eligible rental proceeds received (ETH)<input type="number" min="0.000000000000000001" step="0.01" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} disabled={!data.closed}/></label>
                <button className="primary-button full" disabled={!isOwner || busy || !data.closed || BigInt(Math.floor(Date.now() / 1000)) < data.startDate || BigInt(Math.floor(Date.now() / 1000)) >= data.maturityDate} onClick={deposit}>Record proceeds &amp; allocate investor distributions</button>
                <p className="fine-print">Record the portion of rental proceeds committed to this financing. The contract allocates it across investors by token holdings; each investor can claim their accrued distribution.</p>
                {BigInt(Math.floor(Date.now() / 1000)) >= (data.maturityDate || 0n) && <button className="secondary-button full" disabled={!isOwner || busy} onClick={recoverUnclaimed}>Transfer unclaimed rental to owner</button>}
                {!isOwner && <p className="fine-print">Owner actions are disabled for this wallet.</p>}
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
