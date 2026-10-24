const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RentraFactory", function () {
  async function deployFactory() {
    const [owner, alice] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("RentraFactory");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();
    return { factory, owner, alice };
  }

  async function createListing(factory, signer) {
    const tx = await factory.connect(signer).createListing();
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try { return factory.interface.parseLog(log); } catch { return null; }
      })
      .find((parsed) => parsed && parsed.name === "ListingDeployed");
    return event.args.offering;
  }

  it("deploys listings with no fixed cap and tracks them", async function () {
    const { factory, owner } = await deployFactory();
    const created = [];
    for (let i = 0; i < 10; i += 1) {
      created.push(await createListing(factory, owner));
    }
    expect(await factory.offeringCount()).to.equal(10);
    const all = await factory.getAllOfferings();
    expect(all).to.deep.equal(created);
  });

  it("sets the listing owner to the caller", async function () {
    const { factory, alice } = await deployFactory();
    const offeringAddress = await createListing(factory, alice);
    const offering = await ethers.getContractAt("RentraOffering", offeringAddress);
    expect(await offering.owner()).to.equal(alice.address);
  });

  it("lets the listing owner create an offering on the deployed contract", async function () {
    const { factory, owner } = await deployFactory();
    const offeringAddress = await createListing(factory, owner);
    const offering = await ethers.getContractAt("RentraOffering", offeringAddress);
    const block = await ethers.provider.getBlock("latest");
    const start = BigInt(block.timestamp + 1);
    const maturity = start + 5n * 365n * 24n * 60n * 60n;
    await offering.createOffering("Orchard Residences", "Demo", 4000, ethers.parseEther("4"), start, maturity, 0, 0, 0);
    expect(await offering.offeringCreated()).to.equal(true);
    expect(await offering.propertyName()).to.equal("Orchard Residences");
  });

  it("paginates offerings", async function () {
    const { factory, owner } = await deployFactory();
    for (let i = 0; i < 5; i += 1) {
      await createListing(factory, owner);
    }
    const firstPage = await factory.getOfferingsPaged(0, 2);
    const secondPage = await factory.getOfferingsPaged(2, 2);
    const beyond = await factory.getOfferingsPaged(10, 2);
    expect(firstPage.length).to.equal(2);
    expect(secondPage.length).to.equal(2);
    expect(beyond.length).to.equal(0);
  });
});
