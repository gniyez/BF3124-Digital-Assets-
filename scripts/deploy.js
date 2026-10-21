const hre = require("hardhat");

async function main() {
  const Factory = await hre.ethers.getContractFactory("RentraOffering");
  const { ethers } = hre;
  const year = 365n * 24n * 60n * 60n;
  const listings = [
    {
      name: "Orchard Residences",
      description: "Residential rental income from a central Singapore apartment community.",
      supply: 4000n,
      targetEth: "4"
    },
    {
      name: "Harbourfront Lofts",
      description: "Residential rental income from a waterfront city-fringe development.",
      supply: 3000n,
      targetEth: "6"
    },
    {
      name: "Garden District Offices",
      description: "Commercial rental income from a multi-tenant office property.",
      supply: 5000n,
      targetEth: "10"
    }
  ];
  const contracts = [];
  for (let index = 0; index < 8; index += 1) {
    const contract = await Factory.deploy();
    await contract.waitForDeployment();
    contracts.push(contract);
  }

  const latestBlock = await ethers.provider.getBlock("latest");
  const startDate = BigInt(latestBlock.timestamp + 30);
  const maturityDate = startDate + 5n * year;
  for (let index = 0; index < listings.length; index += 1) {
    const listing = listings[index];
    const targetWei = ethers.parseEther(listing.targetEth);
    await (await contracts[index].createOffering(
      listing.name,
      listing.description,
      listing.supply,
      targetWei,
      startDate,
      maturityDate
    )).wait();
  }
  console.log("Listing contract addresses (include all eight, comma separated in frontend/.env):");
  for (let index = 0; index < contracts.length; index += 1) {
    console.log(`${index + 1}. ${await contracts[index].getAddress()}${index < listings.length ? ` — ${listings[index].name}` : " — available listing slot"}`);
  }
  console.log("Owner:", await contracts[0].owner());
  console.log("Local chain ID: 31337");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
