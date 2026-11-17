// Read-only buyer page: no wallet needed, it only calls view functions.
const provider = new ethers.providers.JsonRpcProvider("http://localhost:8545");
const ipfsGateway = "http://127.0.0.1:8080/ipfs/";

// Only the functions this page needs (human-readable ABI)
const abi = [
    "function tokenIdOfVin(bytes32) view returns (uint256)",
    "function ownerOf(uint256) view returns (address)",
    "function getRecords(uint256) view returns (tuple(address garage, uint256 mileage, uint8 batteryHealth, string recordType, string ipfsCid, uint256 timestamp)[])"
];

document.getElementById('checkButton').addEventListener('click', checkHistory);

async function checkHistory() {
    const result = document.getElementById('result');
    result.innerHTML = 'Loading...';
    try {
        const address = document.getElementById('contractAddress').value.trim();
        const vin = document.getElementById('vin').value.trim().toUpperCase();
        const adMileage = Number(document.getElementById('adMileage').value);
        const adBattery = Number(document.getElementById('adBattery').value);

        const passport = new ethers.Contract(address, abi, provider);
        const vinHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(vin));
        const tokenId = await passport.tokenIdOfVin(vinHash);
        if (tokenId.eq(0)) {
            result.innerHTML = '<p>No Vehicle Passport found for this VIN.</p>';
            return;
        }

        const owner = await passport.ownerOf(tokenId);
        const records = await passport.getRecords(tokenId);

        let html = `<p><b>Passport #${tokenId}</b><br>Current owner: ${owner}</p>`;
        html += '<h3>History</h3><ul>';
        for (const r of records) {
            const date = new Date(r.timestamp.toNumber() * 1000).toLocaleDateString();
            html += `<li>${r.recordType}: ${r.mileage} km, battery ${r.batteryHealth}%`
                  + `<br>by garage ${r.garage} (added ${date})`
                  + `<br><a href="${ipfsGateway}${r.ipfsCid}" target="_blank">Open document in IPFS</a></li>`;
        }
        html += '</ul>';

        if (records.length > 0) {
            const last = records[records.length - 1];
            if (last.mileage.gt(adMileage)) {
                html += `<p style="color:red"><b>Warning:</b> the ad says ${adMileage} km, but a garage recorded ${last.mileage} km.</p>`;
            }
            if (last.batteryHealth < adBattery) {
                html += `<p style="color:red"><b>Warning:</b> the ad says ${adBattery}% battery, but a garage recorded ${last.batteryHealth}%.</p>`;
            }
        }
        result.innerHTML = html;
    } catch (error) {
        console.error(error);
        result.innerHTML = 'Error: ' + error.message + ' (is the Hardhat node running and the contract address correct?)';
    }
}
