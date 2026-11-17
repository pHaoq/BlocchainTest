// VINTrust demo: plays the Marco & Milo story from our project canvas.
//
//   1. SSI  - the association issues an "AuthorizedGarage" credential to a garage
//             (class credential-issuer) and checks it (class credential-verifier).
//             Only if the check passes, the garage is approved in the smart contract.
//   2.        The association creates the Vehicle Passport NFT for Marco's car.
//   3. IPFS - the garage uploads its service reports to IPFS and writes the
//             mileage, battery health and IPFS CID into the passport.
//   4.        Buyer Milo reads the history and compares it with the advertisement.
//   5.        Marco sells the car: the passport NFT moves to Milo, the history stays.
//
// Run (inside Docker, see README.md):  npm run demo

const { ethers } = require("hardhat");
const fs = require("fs");

// Service URLs. Inside the Docker network the containers are reached by name.
// If you run the script directly on your laptop, set them to localhost, e.g.
//   ISSUER_URL=http://localhost:9001 VERIFIER_URL=http://localhost:9002 IPFS_URL=http://localhost:5001
const ISSUER_URL = process.env.ISSUER_URL || "http://credential-issuer:9001";
const VERIFIER_URL = process.env.VERIFIER_URL || "http://credential-verifier:9002";
const IPFS_URL = process.env.IPFS_URL || "http://ipfs_node:5001";

// The car and the advertisement from the canvas story
const VIN = "WVWZZZE1ZMP012345";
const AD = { mileage: 61000, batteryHealth: 92 };

// ---------- helpers: SSI (same calls as ssi/test.js) ----------

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function issueCredential(did, content) {
  return postJson(`${ISSUER_URL}/issue-credential`, {
    issuer: "issuer1", // the VINTrust association uses key "issuer1"
    did: did,
    credential: content,
    registry: "blockchain", // DID document is stored in the DIDRegistry contract
  });
}

async function verifyCredential(credential) {
  const result = await postJson(`${VERIFIER_URL}/verify-credential`, { credential });
  return result.valid === true;
}

// ---------- helpers: IPFS (same API as web-ui/js/ipfs.js) ----------

async function uploadToIpfs(fileName, object) {
  const formData = new FormData();
  formData.append("file", new Blob([JSON.stringify(object, null, 2)]), fileName);
  const response = await fetch(`${IPFS_URL}/api/v0/add`, { method: "POST", body: formData });
  const data = await response.json();
  return data.Hash; // the CID
}

async function readFromIpfs(cid) {
  const response = await fetch(`${IPFS_URL}/api/v0/cat?arg=${cid}`, { method: "POST" });
  return JSON.parse(await response.text());
}

// ---------- the story ----------

async function main() {
  // Hardhat test accounts: 0 = association, 1 = garage, 2 = Marco (seller), 3 = Milo (buyer)
  const [association, garage, marco, milo] = await ethers.getSigners();

  const { VehiclePassport: address } = JSON.parse(fs.readFileSync("deployments.json"));
  const passport = await ethers.getContractAt("VehiclePassport", address);
  console.log(`VehiclePassport contract: ${address}\n`);

  // ----- Step 1: SSI - garage gets a credential, association verifies it -----
  console.log("STEP 1: SSI - Garage Muster AG proves it is an authorized garage");
  const garageDid = `did:eth:${garage.address}`;
  const credential = await issueCredential(garageDid, {
    type: "AuthorizedGarage",
    name: "Garage Muster AG",
    uid: "CHE-123.456.789",
  });
  console.log("  Credential issued to", credential.issuedTo);

  const valid = await verifyCredential(credential);
  console.log("  Verifier says credential is valid:", valid);

  // negative check: a tampered credential must fail
  const fake = { ...credential, content: { ...credential.content, name: "Fake Garage" } };
  console.log("  Tampered credential is valid:", await verifyCredential(fake));

  if (!valid || credential.content.type !== "AuthorizedGarage") {
    throw new Error("Garage credential not valid - garage is NOT approved");
  }
  await (await passport.connect(association).setGarageApproval(garage.address, true)).wait();
  console.log("  Association approved the garage in the smart contract\n");

  // ----- Step 2: create the Vehicle Passport for Marco's car -----
  console.log("STEP 2: Vehicle Passport for Marco's car");
  const vinHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(VIN));
  let tokenId = await passport.tokenIdOfVin(vinHash);
  if (tokenId.eq(0)) {
    await (await passport.connect(association).mintPassport(marco.address, vinHash)).wait();
    tokenId = await passport.tokenIdOfVin(vinHash);
    console.log(`  Passport #${tokenId} minted to Marco (${marco.address})\n`);
  } else {
    console.log(`  Passport #${tokenId} already exists (demo was run before)\n`);
  }

  // ----- Step 3: garage stores service reports in IPFS and on-chain -----
  console.log("STEP 3: Garage adds service records (document -> IPFS, CID -> blockchain)");
  const services = [
    { date: "2021-05-10", mileage: 45000, batteryHealth: 95, recordType: "SERVICE", work: "Annual service, brake fluid" },
    { date: "2023-06-14", mileage: 81000, batteryHealth: 84, recordType: "SERVICE", work: "Annual service, tyres, battery check" },
  ];
  if ((await passport.getRecords(tokenId)).length === 0) {
    for (const s of services) {
      const report = { vin: VIN, garage: "Garage Muster AG", ...s };
      const cid = await uploadToIpfs(`service-${s.date}.json`, report);
      await (await passport.connect(garage).addRecord(tokenId, s.mileage, s.batteryHealth, s.recordType, cid)).wait();
      console.log(`  ${s.date}: ${s.mileage} km, battery ${s.batteryHealth}%  ->  IPFS CID ${cid}`);
    }
  } else {
    console.log("  Records already exist (demo was run before)");
  }

  // Marco is not a garage, so he cannot write (or fake) a record
  try {
    await passport.connect(marco).addRecord(tokenId, 61000, 92, "SERVICE", "fake");
    console.log("  ERROR: Marco could write a record!");
  } catch (e) {
    console.log("  Marco tried to add a fake record -> rejected (Not an approved garage)");
  }
  console.log();

  // ----- Step 4: buyer Milo checks the history -----
  console.log("STEP 4: Milo enters the VIN and checks the advertisement");
  console.log(`  Advertisement: ${AD.mileage} km, battery ${AD.batteryHealth}%`);
  const records = await passport.connect(milo).getRecords(tokenId);
  for (const r of records) {
    const doc = await readFromIpfs(r.ipfsCid); // load the full document from IPFS
    console.log(`  Record ${doc.date}: ${r.mileage} km, battery ${r.batteryHealth}%, ${r.recordType} by ${doc.garage} (${r.garage})`);
  }
  const last = records[records.length - 1];
  if (last.mileage.gt(AD.mileage)) {
    console.log(`  WARNING: mileage in the ad (${AD.mileage}) is LOWER than the recorded ${last.mileage} km!`);
  }
  if (last.batteryHealth < AD.batteryHealth) {
    console.log(`  WARNING: battery health in the ad (${AD.batteryHealth}%) is HIGHER than the recorded ${last.batteryHealth}%!`);
  }
  console.log();

  // ----- Step 5: sale - passport moves to Milo -----
  console.log("STEP 5: Milo buys the car (after a lower counteroffer)");
  if ((await passport.ownerOf(tokenId)) === marco.address) {
    await (await passport.connect(marco).transferFrom(marco.address, milo.address, tokenId)).wait();
  }
  console.log(`  Passport #${tokenId} owner is now: ${await passport.ownerOf(tokenId)} (Milo: ${milo.address})`);
  console.log(`  History still has ${(await passport.getRecords(tokenId)).length} records\n`);

  console.log("Demo finished.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
