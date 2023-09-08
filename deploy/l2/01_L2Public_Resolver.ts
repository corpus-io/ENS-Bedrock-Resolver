import hre, { ethers } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();

    console.log(deployer.address)

    console.log("balance ", ethers.utils.formatEther(await deployer.getBalance()))

    const L2PublicResolverFactory = await ethers.getContractFactory("L2PublicResolver");
    const deployTx = await L2PublicResolverFactory.deploy({
        // gasLimit: 30000000,
        // gasPrice: "90000000"
    });

    await deployTx.deployed();

    console.log(`L2 Public Resolver deployed at  ${deployTx.address}`);
    console.log(`Verify with: npx hardhat verify --network ${hre.network.name}  ${deployTx.address}`);
    console.log(`Run export L2_RESOLVER_ADDRESS=${deployTx.address}`)
    console.log(
        `Verify the contract using  npx hardhat verify --network ${hre.network.name} ${deployTx.address}`
    );

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
