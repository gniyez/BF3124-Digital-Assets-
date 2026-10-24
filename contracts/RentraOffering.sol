// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RentraOffering - educational rental-income tokenisation prototype
/// @notice Demo only. This contract does not create a legally enforceable real-world claim.
contract RentraOffering {
    address public immutable owner;
    string public propertyName;
    string public description;
    uint256 public tokenPriceWei;
    uint256 public fundingTargetWei;
    uint256 public tokenSupply;
    uint256 public tokensSold;
    uint256 public fundingDeadline; // 0 means no deadline; otherwise purchases stop at this time
    // Owner's projected figures at listing time. Informational estimates, not on-chain guarantees.
    uint256 public projectedMonthlyIncomeWei;
    uint256 public projectedTotalIncomeWei;
    bool public offeringCreated;
    bool public fundingClosed;

    uint256 public totalRaised;
    uint256 public totalCapitalTransferredToOwner;
    bool public capitalWithdrawn;
    uint256 public startDate;
    uint256 public maturityDate;
    uint256 public investorShareBps;
    uint256 public totalRentalDeposited;
    uint256 public totalInvestorRentalAllocated;
    uint256 public totalRentalClaimed;
    uint256 public totalRentalTransferredToOwner;

    mapping(address => uint256) public balanceOf;

    // --- Secondary market (peer-to-peer resale) ---
    // A seller lists some of their tokens at a total price; a buyer pays that price and
    // receives the tokens. Tokens stay in the seller's balance until the sale completes.
    struct Sale {
        uint256 amount;   // number of tokens offered
        uint256 priceWei; // total price for the whole lot
    }
    mapping(address => Sale) public saleOf;

    uint256 private constant SCALE = 1e18;
    uint256 public accumulatedRentalPerToken;
    mapping(address => uint256) public rewardIndexPaid;
    mapping(address => uint256) public accruedRental;
    bool private transferInProgress;

    event OfferingCreated(string propertyName, uint256 tokenSupply, uint256 tokenPriceWei);
    event TokensPurchased(address indexed investor, uint256 amount, uint256 payment);
    event FundingClosed(uint256 tokensSold);
    event CapitalTransferredToOwner(uint256 amount);
    event RentalIncomeDeposited(address indexed operator, uint256 grossAmount, uint256 investorAmount, uint256 ownerAmount);
    event DistributionClaimed(address indexed investor, uint256 amount);
    event UnclaimedRentalTransferredToOwner(uint256 amount);
    event TokensTransferred(address indexed from, address indexed to, uint256 amount);
    event SaleListed(address indexed seller, uint256 amount, uint256 priceWei);
    event SaleCancelled(address indexed seller);
    event SaleFilled(address indexed seller, address indexed buyer, uint256 amount, uint256 priceWei);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier noTransferReentry() {
        require(!transferInProgress, "Transfer in progress");
        transferInProgress = true;
        _;
        transferInProgress = false;
    }

    constructor(address _owner) {
        owner = _owner == address(0) ? msg.sender : _owner;
    }

    function createOffering(
        string calldata _propertyName,
        string calldata _description,
        uint256 _tokenSupply,
        uint256 _fundingTargetWei,
        uint256 _startDate,
        uint256 _maturityDate,
        uint256 _fundingDeadline,
        uint256 _projectedMonthlyIncomeWei,
        uint256 _projectedTotalIncomeWei
    ) external onlyOwner {
        require(!offeringCreated, "Offering already created");
        require(bytes(_propertyName).length > 0, "Property name required");
        require(_tokenSupply > 0, "Supply must be positive");
        require(_fundingTargetWei > 0, "Target must be positive");
        require(_fundingTargetWei % _tokenSupply == 0, "Target must divide evenly by supply");
        require(_startDate >= block.timestamp, "Start must be in the future");
        require(_maturityDate > _startDate, "Maturity must follow start");
        // Deadline is optional (0 = none). If set, it must be in the future and before maturity.
        require(_fundingDeadline == 0 || _fundingDeadline > block.timestamp, "Deadline must be in the future");
        require(_fundingDeadline == 0 || _fundingDeadline <= _maturityDate, "Deadline must be on or before maturity");

        propertyName = _propertyName;
        description = _description;
        tokenSupply = _tokenSupply;
        fundingTargetWei = _fundingTargetWei;
        tokenPriceWei = _fundingTargetWei / _tokenSupply;
        startDate = _startDate;
        maturityDate = _maturityDate;
        fundingDeadline = _fundingDeadline;
        projectedMonthlyIncomeWei = _projectedMonthlyIncomeWei;
        projectedTotalIncomeWei = _projectedTotalIncomeWei;
        investorShareBps = 10_000;
        offeringCreated = true;

        emit OfferingCreated(_propertyName, _tokenSupply, tokenPriceWei);
    }

    /// @dev Settle an account's accrued rental up to the current index so that any
    ///      balance change (e.g. a new purchase) only earns from future deposits.
    function _syncRewards(address account) internal {
        uint256 newlyAccrued = (balanceOf[account] *
            (accumulatedRentalPerToken - rewardIndexPaid[account])) / SCALE;
        if (newlyAccrued > 0) {
            accruedRental[account] += newlyAccrued;
        }
        rewardIndexPaid[account] = accumulatedRentalPerToken;
    }

    /// @dev Move tokens between holders, settling each side's accrued rental first so the
    ///      recipient only earns from deposits made after the transfer, and the sender keeps
    ///      the rental already accrued on the tokens they held.
    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "Zero address");
        require(from != to, "Self transfer");
        require(amount > 0, "Amount must be positive");
        require(block.timestamp < maturityDate, "Financing has matured");
        require(balanceOf[from] >= amount, "Insufficient balance");

        _syncRewards(from);
        _syncRewards(to);

        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit TokensTransferred(from, to, amount);
    }

    /// @notice Transfer tokens directly to another holder (gift or off-platform deal).
    function transfer(address to, uint256 amount) external {
        // A direct transfer of listed tokens could leave a dangling sale; clear any listing
        // if the sender no longer has enough tokens to honour it.
        _transfer(msg.sender, to, amount);
        _pruneSale(msg.sender);
    }

    function buyTokens(uint256 amount) external payable {
        require(offeringCreated, "No offering");
        require(!fundingClosed, "Funding is closed");
        require(fundingDeadline == 0 || block.timestamp < fundingDeadline, "Funding deadline passed");
        require(amount > 0, "Amount must be positive");
        require(tokensSold + amount <= tokenSupply, "Not enough tokens left");

        uint256 cost = amount * tokenPriceWei;
        require(msg.value == cost, "Send exact payment");

        // Snapshot any already-accrued rental before the balance grows, so the new
        // tokens only earn from rental income deposited after this purchase.
        _syncRewards(msg.sender);

        balanceOf[msg.sender] += amount;
        tokensSold += amount;
        totalRaised += msg.value;
        emit TokensPurchased(msg.sender, amount, msg.value);

        // Funding closes automatically once every token has been sold.
        if (tokensSold == tokenSupply) {
            fundingClosed = true;
            emit FundingClosed(tokensSold);
        }
    }

    function closeFunding() external onlyOwner {
        require(offeringCreated, "No offering");
        require(!fundingClosed, "Already closed");
        require(tokensSold > 0, "No tokens sold");
        fundingClosed = true;
        emit FundingClosed(tokensSold);
    }

    /// @notice Releases all proceeds from token sales once, after funding closes.
    function withdrawRaisedCapital() external onlyOwner noTransferReentry {
        require(fundingClosed, "Close funding first");
        require(!capitalWithdrawn, "Capital already withdrawn");
        capitalWithdrawn = true;
        uint256 amount = totalRaised;
        totalCapitalTransferredToOwner = amount;
        (bool success, ) = payable(owner).call{value: amount}("");
        require(success, "Payment failed");
        emit CapitalTransferredToOwner(amount);
    }

    function depositRentalIncome() external payable onlyOwner {
        require(offeringCreated, "No offering");
        require(block.timestamp >= startDate, "Financing has not started");
        require(block.timestamp < maturityDate, "Financing has matured");
        require(msg.value > 0, "Deposit must be positive");
        require(tokensSold > 0, "No tokens sold");

        totalRentalDeposited += msg.value;

        // Each deposit is split across the FULL token supply, so a holder of X% of the
        // supply receives X% of the deposit. The portion mapped to unsold tokens is not
        // allocated to anyone and remains in the contract for the owner to recover at maturity.
        uint256 perToken = (msg.value * SCALE) / tokenSupply;
        accumulatedRentalPerToken += perToken;

        // Only the amount actually mapped to sold tokens is claimable by investors.
        uint256 investorAmount = (perToken * tokensSold) / SCALE;
        totalInvestorRentalAllocated += investorAmount;

        emit RentalIncomeDeposited(msg.sender, msg.value, investorAmount, msg.value - investorAmount);
    }

    function claimable(address investor) public view returns (uint256) {
        if (block.timestamp >= maturityDate) return 0;
        uint256 newlyAccrued = (balanceOf[investor] *
            (accumulatedRentalPerToken - rewardIndexPaid[investor])) / SCALE;
        return accruedRental[investor] + newlyAccrued;
    }

    function claimDistribution() external noTransferReentry {
        require(block.timestamp < maturityDate, "Financing has matured");
        uint256 amount = claimable(msg.sender);
        require(amount > 0, "Nothing to claim");

        accruedRental[msg.sender] = 0;
        rewardIndexPaid[msg.sender] = accumulatedRentalPerToken;
        totalRentalClaimed += amount;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Payment failed");
        emit DistributionClaimed(msg.sender, amount);
    }

    // ============================================================
    //  Secondary market: list, cancel, and buy resale lots
    // ============================================================

    /// @notice List some of your tokens for resale at a total price (one lot per seller).
    function listForSale(uint256 amount, uint256 priceWei) external {
        require(offeringCreated, "No offering");
        require(block.timestamp < maturityDate, "Financing has matured");
        require(amount > 0, "Amount must be positive");
        require(priceWei > 0, "Price must be positive");
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        saleOf[msg.sender] = Sale({ amount: amount, priceWei: priceWei });
        emit SaleListed(msg.sender, amount, priceWei);
    }

    /// @notice Cancel your active resale listing.
    function cancelSale() external {
        require(saleOf[msg.sender].amount > 0, "No active listing");
        delete saleOf[msg.sender];
        emit SaleCancelled(msg.sender);
    }

    /// @dev Remove a seller's listing if they can no longer cover it.
    function _pruneSale(address seller) internal {
        if (saleOf[seller].amount > 0 && balanceOf[seller] < saleOf[seller].amount) {
            delete saleOf[seller];
            emit SaleCancelled(seller);
        }
    }

    /// @notice Buy a seller's entire listed lot. Pay the exact listed price; the tokens move
    ///         to you and the ETH is forwarded to the seller. Rental accrued before the sale
    ///         stays with the seller; you earn from deposits made after the purchase.
    function buyResale(address seller) external payable noTransferReentry {
        Sale memory sale = saleOf[seller];
        require(sale.amount > 0, "No active listing");
        require(msg.sender != seller, "Cannot buy your own listing");
        require(msg.value == sale.priceWei, "Send exact price");
        require(balanceOf[seller] >= sale.amount, "Seller no longer holds enough");

        // Clear the listing before moving funds/tokens (checks-effects-interactions).
        delete saleOf[seller];

        _transfer(seller, msg.sender, sale.amount);

        (bool success, ) = payable(seller).call{value: msg.value}("");
        require(success, "Payment to seller failed");
        emit SaleFilled(seller, msg.sender, sale.amount, sale.priceWei);
    }

    /// @notice After maturity, all deposited rental income not claimed by investors is
    ///         returned to the owner. This includes both genuinely-unclaimed allocations and
    ///         the portion of each deposit that mapped to unsold tokens (never allocated).
    ///         Raised capital is handled separately by withdrawRaisedCapital().
    function transferUnclaimedRentalToOwner() external onlyOwner noTransferReentry {
        require(block.timestamp >= maturityDate, "Financing has not matured");
        uint256 amount = totalRentalDeposited - totalRentalClaimed - totalRentalTransferredToOwner;
        require(amount > 0, "No unclaimed rental");
        totalRentalTransferredToOwner += amount;
        (bool success, ) = payable(owner).call{value: amount}("");
        require(success, "Payment failed");
        emit UnclaimedRentalTransferredToOwner(amount);
    }

    function ownerWithdrawUnsoldFunds() external pure {
        revert("Disabled in demo");
    }
}
