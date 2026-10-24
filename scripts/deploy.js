const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// Write VITE_RENTRA_FACTORY_ADDRESS into frontend/.env, preserving any other variables.
function writeFactoryAddressToEnv(address) {
  const envPath = path.join(__dirname, "..", "frontend", ".env");
  const key = "VITE_RENTRA_FACTORY_ADDRESS";
  const line = `${key}=${address}`;
  let contents = "";
  try {
    contents = fs.readFileSync(envPath, "utf8");
  } catch {
    // No .env yet — we'll create one.
  }
  const lines = contents.split(/\r?\n/);
  let replaced = false;
  const updated = lines.map((l) => {
    if (l.trimStart().startsWith(`${key}=`)) {
      replaced = true;
      return line;
    }
    return l;
  });
  if (!replaced) {
    // Drop any trailing blank lines, append the key, keep a single trailing newline.
    while (updated.length && updated[updated.length - 1].trim() === "") updated.pop();
    updated.push(line);
  }
  let out = updated.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  fs.writeFileSync(envPath, out, "utf8");
  return envPath;
}

async function main() {
  const { ethers } = hre;
  const year = 365n * 24n * 60n * 60n;

  // Pre-loaded demo listings. Add or remove entries here to change what is seeded.
  const listings = [
    {
      name: "Orchard Residences",
      description: "Residential rental income from a central Singapore apartment community.",
      supply: 4000n,
      targetEth: "4",
      monthlyIncomeEth: "0.08",
      totalIncomeEth: "4.8"
    },
    {
      name: "Harbourfront Lofts",
      description: "Residential rental income from a waterfront city-fringe development.",
      supply: 3000n,
      targetEth: "6",
      monthlyIncomeEth: "0.12",
      totalIncomeEth: "7.2"
    }
  ];

  // One factory deploys and tracks every listing. The frontend only needs this address.
  const Factory = await ethers.getContractFactory("RentraFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();

  const Offering = await ethers.getContractFactory("RentraOffering");

  const latestBlock = await ethers.provider.getBlock("latest");
  const startDate = BigInt(latestBlock.timestamp + 30);
  const maturityDate = startDate + 5n * year;

  const seeded = [];
  for (let index = 0; index < listings.length; index += 1) {
    const listing = listings[index];

    // Deploy a listing through the factory so it is tracked on-chain.
    const tx = await factory.createListing();
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return factory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "ListingDeployed");
    const offeringAddress = event.args.offering;

    const offering = Offering.attach(offeringAddress);
    const targetWei = ethers.parseEther(listing.targetEth);
    // Seeded listings use no funding deadline (0). Owners can set one when creating new listings.
    const fundingDeadline = 0n;
    const projectedMonthly = ethers.parseEther(listing.monthlyIncomeEth);
    const projectedTotal = ethers.parseEther(listing.totalIncomeEth);
    await (await offering.createOffering(
      listing.name,
      listing.description,
      listing.supply,
      targetWei,
      startDate,
      maturityDate,
      fundingDeadline,
      projectedMonthly,
      projectedTotal
    )).wait();

    seeded.push({ name: listing.name, address: offeringAddress });
  }

  // Automatically write the factory address into frontend/.env so no manual copy-paste is needed.
  let envPath = null;
  try {
    envPath = writeFactoryAddressToEnv(factoryAddress);
  } catch (error) {
    console.warn("Could not write frontend/.env automatically:", error.message);
  }

  console.log("Rentra factory deployed.");
  console.log(`VITE_RENTRA_FACTORY_ADDRESS=${factoryAddress}`);
  if (envPath) {
    console.log(`Wrote factory address to ${envPath}`);
  } else {
    console.log("Put ONLY this address in frontend/.env (automatic write failed).");
  }
  console.log("");
  console.log(`Seeded ${seeded.length} demo listing(s):`);
  for (let index = 0; index < seeded.length; index += 1) {
    console.log(`${index + 1}. ${seeded[index].name} — ${seeded[index].address}`);
  }
  console.log("Owner:", (await ethers.getSigners())[0].address);
  console.log("Local chain ID: 31337");
  console.log("");
  console.log("Next: restart the Vite dev server so it picks up the new address.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
