const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const VehiclePassport = await ethers.getContractFactory("VehiclePassport");
  const vehiclePassport = await VehiclePassport.deploy();
  await vehiclePassport.deployed();
  console.log("VehiclePassport deployed to:", vehiclePassport.address);

  // Save the address so scripts/demo_vintrust.js can find it
  fs.writeFileSync("deployments.json", JSON.stringify({ VehiclePassport: vehiclePassport.address }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
