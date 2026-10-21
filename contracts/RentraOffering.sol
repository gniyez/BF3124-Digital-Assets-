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

    constructor() {
        owner = msg.sender;
    }

    function createOffering(
        string calldata _propertyName,
        string calldata _description,
        uint256 _tokenSupply,
        uint256 _fundingTargetWei,
        uint256 _startDate,
        uint256 _maturityDate
    ) external onlyOwner {
        require(!offeringCreated, "Offering already created");
        require(bytes(_propertyName).length > 0, "Property name required");
        require(_tokenSupply > 0, "Supply must be positive");
        require(_fundingTargetWei > 0, "Target must be positive");
        require(_fundingTargetWei % _tokenSupply == 0, "Target must divide evenly by supply");
        require(_startDate >= block.timestamp, "Start must be in the future");
        require(_maturityDate > _startDate, "Maturity must follow start");

        propertyName = _propertyName;
        description = _description;
        tokenSupply = _tokenSupply;
        fundingTargetWei = _fundingTargetWei;
        tokenPriceWei = _fundingTargetWei / _tokenSupply;
        startDate = _startDate;
        maturityDate = _maturityDate;
        investorShareBps = 10_000;
        offeringCreated = true;

        emit OfferingCreated(_propertyName, _tokenSupply, tokenPriceWei);
    }

    function buyTokens(uint256 amount) external payable {
        require(offeringCreated, "No offering");
        require(!fundingClosed, "Funding is closed");
        require(amount > 0, "Amount must be positive");
        require(tokensSold + amount <= tokenSupply, "Not enough tokens left");

        uint256 cost = amount * tokenPriceWei;
        require(msg.value == cost, "Send exact payment");

        balanceOf[msg.sender] += amount;
        tokensSold += amount;
        totalRaised += msg.value;
        emit TokensPurchased(msg.sender, amount, msg.value);
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
        require(fundingClosed, "Close funding first");
        require(block.timestamp >= startDate, "Financing has not started");
        require(block.timestamp < maturityDate, "Financing has matured");
        require(msg.value > 0, "Deposit must be positive");
        require(tokensSold > 0, "No tokens sold");

        uint256 investorAmount = msg.value;
        uint256 ownerAmount = 0;
        totalRentalDeposited += msg.value;
        totalInvestorRentalAllocated += investorAmount;
        accumulatedRentalPerToken += (investorAmount * SCALE) / tokensSold;

        if (ownerAmount > 0) {
            totalRentalTransferredToOwner += ownerAmount;
            (bool success, ) = payable(owner).call{value: ownerAmount}("");
            require(success, "Owner payment failed");
        }
        emit RentalIncomeDeposited(msg.sender, msg.value, investorAmount, ownerAmount);
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

    /// @notice After maturity, investor allocations left unclaimed are returned to the owner.
    function transferUnclaimedRentalToOwner() external onlyOwner noTransferReentry {
        require(block.timestamp >= maturityDate, "Financing has not matured");
        uint256 amount = totalInvestorRentalAllocated - totalRentalClaimed;
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
