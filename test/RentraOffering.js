const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RentraOffering", function () {
  async function setup() {
    const [owner, alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("RentraOffering");
    const contract = await Factory.deploy(owner.address);
    await contract.waitForDeployment();
    const price = ethers.parseEther("0.001");
    const block = await ethers.provider.getBlock("latest");
    const start = BigInt(block.timestamp + 1);
    const maturity = start + 5n * 365n * 24n * 60n * 60n;
    await contract.createOffering("Orchard Residences", "Demo rental-income rights", 4000, price * 4000n, start, maturity, 0, 0, 0);
    return { contract, owner, alice, bob, price };
  }

  it("lets an investor buy tokens at the exact price", async function () {
    const { contract, alice, price } = await setup();
    await contract.connect(alice).buyTokens(100, { value: price * 100n });
    expect(await contract.balanceOf(alice.address)).to.equal(100);
    expect(await contract.tokensSold()).to.equal(100);
  });

  it("rejects purchases with incorrect payment", async function () {
    const { contract, alice } = await setup();
    await expect(contract.connect(alice).buyTokens(100, { value: 1 }))
      .to.be.revertedWith("Send exact payment");
  });

  it("distributes rental income proportionally after funding closes", async function () {
    const { contract, owner, alice, bob, price } = await setup();
    await contract.connect(alice).buyTokens(100, { value: price * 100n });
    await contract.connect(bob).buyTokens(300, { value: price * 300n });
    await contract.closeFunding();
    await contract.depositRentalIncome({ value: ethers.parseEther("1") });

    // Income is split across the full 4000-token supply: alice holds 100/4000 = 2.5%,
    // bob holds 300/4000 = 7.5%. The remaining 90% (unsold tokens) is not allocated.
    expect(await contract.claimable(alice.address)).to.equal(ethers.parseEther("0.025"));
    expect(await contract.claimable(bob.address)).to.equal(ethers.parseEther("0.075"));
  });

  it("pays a holder their supply-share of a deposit (25% of supply -> 25% of income)", async function () {
    const { contract, alice } = await setup();
    // Supply is 4000; Alice buys 1000 tokens = 25% of the supply.
    await contract.connect(alice).buyTokens(1000, { value: ethers.parseEther("0.001") * 1000n });
    await contract.depositRentalIncome({ value: ethers.parseEther("100") });
    // With no prior unclaimed distributions, Alice can claim exactly 25% of 100 ETH.
    expect(await contract.claimable(alice.address)).to.equal(ethers.parseEther("25"));
  });

  it("prevents non-owners from creating offerings or depositing income", async function () {
    const { contract, alice, price } = await setup();
    const block = await ethers.provider.getBlock("latest");
    const start = BigInt(block.timestamp + 1);
    const maturity = start + 5n * 365n * 24n * 60n * 60n;
    await expect(contract.connect(alice).createOffering("Fake", "No", 10, price * 10n, start, maturity, 0, 0, 0))
      .to.be.revertedWith("Only owner");
    await contract.connect(alice).buyTokens(1, { value: price });
    await contract.closeFunding();
    await expect(contract.connect(alice).depositRentalIncome({ value: 100 }))
      .to.be.revertedWith("Only owner");
  });

  async function setupWithDeadline(deadlineOffsetSeconds) {
    const [owner, alice] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("RentraOffering");
    const contract = await Factory.deploy(owner.address);
    await contract.waitForDeployment();
    const price = ethers.parseEther("0.001");
    const block = await ethers.provider.getBlock("latest");
    const start = BigInt(block.timestamp + 1);
    const maturity = start + 5n * 365n * 24n * 60n * 60n;
    const deadline = BigInt(block.timestamp + deadlineOffsetSeconds);
    await contract.createOffering("Deadline Demo", "Has a funding deadline", 4000, price * 4000n, start, maturity, deadline, 0, 0);
    return { contract, owner, alice, price, deadline };
  }

  it("stores an optional funding deadline (0 = none)", async function () {
    const { contract } = await setup();
    expect(await contract.fundingDeadline()).to.equal(0n);
    const withDeadline = await setupWithDeadline(3600);
    expect(await withDeadline.contract.fundingDeadline()).to.equal(withDeadline.deadline);
  });

  it("allows purchases before the deadline", async function () {
    const { contract, alice, price } = await setupWithDeadline(3600);
    await contract.connect(alice).buyTokens(10, { value: price * 10n });
    expect(await contract.balanceOf(alice.address)).to.equal(10);
  });

  it("rejects purchases once the deadline has passed", async function () {
    const { contract, alice, price } = await setupWithDeadline(100);
    await ethers.provider.send("evm_increaseTime", [200]);
    await ethers.provider.send("evm_mine", []);
    await expect(contract.connect(alice).buyTokens(10, { value: price * 10n }))
      .to.be.revertedWith("Funding deadline passed");
  });

  it("stores the owner's projected income figures", async function () {
    const [owner] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("RentraOffering");
    const contract = await Factory.deploy(owner.address);
    await contract.waitForDeployment();
    const price = ethers.parseEther("0.001");
    const block = await ethers.provider.getBlock("latest");
    const start = BigInt(block.timestamp + 1);
    const maturity = start + 5n * 365n * 24n * 60n * 60n;
    const monthly = ethers.parseEther("0.08");
    const total = ethers.parseEther("4.8");
    await contract.createOffering("Orchard Residences", "Demo", 4000, price * 4000n, start, maturity, 0, monthly, total);
    expect(await contract.projectedMonthlyIncomeWei()).to.equal(monthly);
    expect(await contract.projectedTotalIncomeWei()).to.equal(total);
  });

  it("distributes rental income without closing funding first", async function () {
    const { contract, alice, bob, price } = await setup();
    await contract.connect(alice).buyTokens(100, { value: price * 100n });
    await contract.connect(bob).buyTokens(300, { value: price * 300n });
    // No closeFunding() call here.
    expect(await contract.fundingClosed()).to.equal(false);
    await contract.depositRentalIncome({ value: ethers.parseEther("1") });
    expect(await contract.claimable(alice.address)).to.equal(ethers.parseEther("0.025"));
    expect(await contract.claimable(bob.address)).to.equal(ethers.parseEther("0.075"));
  });

  it("closes funding automatically when all tokens are sold", async function () {
    const { contract, alice, price } = await setup();
    expect(await contract.fundingClosed()).to.equal(false);
    await contract.connect(alice).buyTokens(4000, { value: price * 4000n });
    expect(await contract.tokensSold()).to.equal(4000);
    expect(await contract.fundingClosed()).to.equal(true);
    // Further purchases are rejected because funding is now closed.
    await expect(contract.connect(alice).buyTokens(1, { value: price }))
      .to.be.revertedWith("Funding is closed");
  });

  it("does not let a later buyer claim rental deposited before they bought", async function () {
    const { contract, alice, bob, price } = await setup();
    await contract.connect(alice).buyTokens(100, { value: price * 100n });
    // Deposit while only Alice holds tokens. Alice's share: 100/4000 of 1 ETH = 0.025.
    await contract.depositRentalIncome({ value: ethers.parseEther("1") });
    // Bob buys afterwards.
    await contract.connect(bob).buyTokens(100, { value: price * 100n });
    // Bob was not invested at the time of the first deposit, so he can claim nothing yet.
    expect(await contract.claimable(bob.address)).to.equal(0n);
    // Alice keeps her share of the first deposit.
    expect(await contract.claimable(alice.address)).to.equal(ethers.parseEther("0.025"));
    // A second deposit: each of the two equal 100-token holders gets 100/4000 of 1 ETH = 0.025.
    await contract.depositRentalIncome({ value: ethers.parseEther("1") });
    expect(await contract.claimable(bob.address)).to.equal(ethers.parseEther("0.025"));
    expect(await contract.claimable(alice.address)).to.equal(ethers.parseEther("0.05"));
  });

  it("transfers tokens and settles rental so the buyer only earns from later deposits", async function () {
    const { contract, alice, bob, price } = await setup();
    await contract.connect(alice).buyTokens(1000, { value: price * 1000n }); // 25% of 4000
    // Deposit while Alice holds all 1000 tokens: Alice accrues 25% of 1 ETH = 0.25.
    await contract.depositRentalIncome({ value: ethers.parseEther("1") });
    // Alice transfers half her tokens to Bob.
    await contract.connect(alice).transfer(bob.address, 500);
    expect(await contract.balanceOf(alice.address)).to.equal(500);
    expect(await contract.balanceOf(bob.address)).to.equal(500);
    // The earlier deposit stays with Alice; Bob has nothing yet.
    expect(await contract.claimable(alice.address)).to.equal(ethers.parseEther("0.25"));
    expect(await contract.claimable(bob.address)).to.equal(0n);
    // A new deposit splits across their now-equal holdings: each 500/4000 of 1 ETH = 0.125.
    await contract.depositRentalIncome({ value: ethers.parseEther("1") });
    expect(await contract.claimable(alice.address)).to.equal(ethers.parseEther("0.375"));
    expect(await contract.claimable(bob.address)).to.equal(ethers.parseEther("0.125"));
  });

  it("rejects transfers after maturity", async function () {
    const { contract, alice, bob, price } = await setup();
    await contract.connect(alice).buyTokens(100, { value: price * 100n });
    await ethers.provider.send("evm_increaseTime", [5 * 365 * 24 * 60 * 60 + 10]);
    await ethers.provider.send("evm_mine", []);
    await expect(contract.connect(alice).transfer(bob.address, 50))
      .to.be.revertedWith("Financing has matured");
  });

  it("supports a secondary-market resale: list, buy, and move tokens + payment", async function () {
    const { contract, alice, bob, price } = await setup();
    await contract.connect(alice).buyTokens(1000, { value: price * 1000n });
    const salePrice = ethers.parseEther("2");
    await contract.connect(alice).listForSale(400, salePrice);
    const sale = await contract.saleOf(alice.address);
    expect(sale.amount).to.equal(400n);
    expect(sale.priceWei).to.equal(salePrice);

    const aliceBefore = await ethers.provider.getBalance(alice.address);
    await contract.connect(bob).buyResale(alice.address, { value: salePrice });

    // Tokens moved to Bob; listing cleared.
    expect(await contract.balanceOf(alice.address)).to.equal(600n);
    expect(await contract.balanceOf(bob.address)).to.equal(400n);
    expect((await contract.saleOf(alice.address)).amount).to.equal(0n);
    // Seller received the ETH.
    const aliceAfter = await ethers.provider.getBalance(alice.address);
    expect(aliceAfter - aliceBefore).to.equal(salePrice);
  });

  it("rejects a resale purchase with the wrong amount of ETH", async function () {
    const { contract, alice, bob, price } = await setup();
    await contract.connect(alice).buyTokens(100, { value: price * 100n });
    await contract.connect(alice).listForSale(50, ethers.parseEther("1"));
    await expect(contract.connect(bob).buyResale(alice.address, { value: ethers.parseEther("0.5") }))
      .to.be.revertedWith("Send exact price");
  });

  it("lets a seller cancel a resale listing", async function () {
    const { contract, alice, price } = await setup();
    await contract.connect(alice).buyTokens(100, { value: price * 100n });
    await contract.connect(alice).listForSale(50, ethers.parseEther("1"));
    await contract.connect(alice).cancelSale();
    expect((await contract.saleOf(alice.address)).amount).to.equal(0n);
  });

  it("rejects a deadline in the past or after maturity at creation", async function () {
    const [owner] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("RentraOffering");
    const price = ethers.parseEther("0.001");

    // Each failed createOffering still mines a block, so use a fresh contract and
    // generous future timestamps per assertion to avoid tripping the start-date check.
    const first = await Factory.deploy(owner.address);
    await first.waitForDeployment();
    let block = await ethers.provider.getBlock("latest");
    let start = BigInt(block.timestamp + 1000);
    let maturity = start + 5n * 365n * 24n * 60n * 60n;
    await expect(first.createOffering("Bad", "Past deadline", 4000, price * 4000n, start, maturity, BigInt(block.timestamp - 10), 0, 0))
      .to.be.revertedWith("Deadline must be in the future");

    const second = await Factory.deploy(owner.address);
    await second.waitForDeployment();
    block = await ethers.provider.getBlock("latest");
    start = BigInt(block.timestamp + 1000);
    maturity = start + 5n * 365n * 24n * 60n * 60n;
    await expect(second.createOffering("Bad", "After maturity", 4000, price * 4000n, start, maturity, maturity + 1n, 0, 0))
      .to.be.revertedWith("Deadline must be on or before maturity");
  });
});
