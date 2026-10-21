const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RentraOffering", function () {
  async function setup() {
    const [owner, alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("RentraOffering");
    const contract = await Factory.deploy();
    await contract.waitForDeployment();
    const price = ethers.parseEther("0.001");
    const block = await ethers.provider.getBlock("latest");
    const start = BigInt(block.timestamp + 1);
    const maturity = start + 5n * 365n * 24n * 60n * 60n;
    await contract.createOffering("Orchard Residences", "Demo rental-income rights", 4000, price * 4000n, start, maturity);
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

    expect(await contract.claimable(alice.address)).to.equal(ethers.parseEther("0.25"));
    expect(await contract.claimable(bob.address)).to.equal(ethers.parseEther("0.75"));
  });

  it("prevents non-owners from creating offerings or depositing income", async function () {
    const { contract, alice, price } = await setup();
    const block = await ethers.provider.getBlock("latest");
    const start = BigInt(block.timestamp + 1);
    const maturity = start + 5n * 365n * 24n * 60n * 60n;
    await expect(contract.connect(alice).createOffering("Fake", "No", 10, price * 10n, start, maturity))
      .to.be.revertedWith("Only owner");
    await contract.connect(alice).buyTokens(1, { value: price });
    await contract.closeFunding();
    await expect(contract.connect(alice).depositRentalIncome({ value: 100 }))
      .to.be.revertedWith("Only owner");
  });
});
