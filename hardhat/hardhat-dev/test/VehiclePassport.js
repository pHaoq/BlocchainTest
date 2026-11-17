const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VehiclePassport", function () {
  let passport;
  let association, garage, marco, milo;
  const VIN = "WVWZZZE1ZMP012345";
  const vinHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(VIN));
  const CID = "QmTestCid123";

  beforeEach(async function () {
    [association, garage, marco, milo] = await ethers.getSigners();
    const VehiclePassport = await ethers.getContractFactory("VehiclePassport");
    passport = await VehiclePassport.deploy();
    await passport.deployed();

    await passport.mintPassport(marco.address, vinHash); // token id 1
    await passport.setGarageApproval(garage.address, true);
  });

  it("mints one passport per VIN to the car owner", async function () {
    expect(await passport.tokenIdOfVin(vinHash)).to.equal(1);
    expect(await passport.ownerOf(1)).to.equal(marco.address);
    await expect(passport.mintPassport(milo.address, vinHash))
      .to.be.revertedWith("Passport for this VIN already exists");
  });

  it("only the association can mint and approve garages", async function () {
    const otherVin = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("OTHERVIN000000000"));
    await expect(passport.connect(marco).mintPassport(marco.address, otherVin)).to.be.reverted;
    await expect(passport.connect(marco).setGarageApproval(marco.address, true)).to.be.reverted;
  });

  it("an approved garage can add a record and anyone can read it", async function () {
    await passport.connect(garage).addRecord(1, 81000, 84, "SERVICE", CID);
    const records = await passport.connect(milo).getRecords(1);
    expect(records.length).to.equal(1);
    expect(records[0].garage).to.equal(garage.address);
    expect(records[0].mileage).to.equal(81000);
    expect(records[0].batteryHealth).to.equal(84);
    expect(records[0].ipfsCid).to.equal(CID);
  });

  it("rejects records from addresses that are not approved garages", async function () {
    await expect(passport.connect(marco).addRecord(1, 50000, 90, "SERVICE", CID))
      .to.be.revertedWith("Not an approved garage");
  });

  it("rejects records after a garage was revoked", async function () {
    await passport.setGarageApproval(garage.address, false);
    await expect(passport.connect(garage).addRecord(1, 50000, 90, "SERVICE", CID))
      .to.be.revertedWith("Not an approved garage");
  });

  it("rejects a mileage lower than the last record (odometer fraud)", async function () {
    await passport.connect(garage).addRecord(1, 81000, 84, "SERVICE", CID);
    await expect(passport.connect(garage).addRecord(1, 61000, 92, "SERVICE", CID))
      .to.be.revertedWith("Mileage lower than last record");
  });

  it("rejects records for a passport that does not exist", async function () {
    await expect(passport.connect(garage).addRecord(99, 1000, 100, "SERVICE", CID))
      .to.be.revertedWith("Passport does not exist");
  });

  it("keeps the history when the car is sold", async function () {
    await passport.connect(garage).addRecord(1, 81000, 84, "SERVICE", CID);
    await passport.connect(marco).transferFrom(marco.address, milo.address, 1);
    expect(await passport.ownerOf(1)).to.equal(milo.address);
    expect((await passport.getRecords(1)).length).to.equal(1);
  });
});
