import { FakeContract } from "@defi-wonderland/smock";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import bodyParser from "body-parser";
import { ethers } from "ethers";
import express from "express";
import { ethers as hreEthers } from "hardhat";
import request from "supertest";
import { BedrockProofVerifier, ENS, L2OutputOracle, L2OutputOracle__factory, OptimismResolver } from "typechain";
import { ccipGateway } from "../../gateway/http/ccipGateway";
import { mockEnsRegistry } from "../contracts/l1/OptimismResolver/mockEnsRegistry";
import { MockProvider } from "../contracts/l1/OptimismResolver/mockProvider";
import { getGateWayUrl } from "../helper/getGatewayUrl";
const { expect } = require("chai");

describe("OptimismResolver Test", () => {
    let owner: SignerWithAddress;
    //ENS
    let ensRegistry: FakeContract<ENS>;
    //OP
    let l2OutputOracle: L2OutputOracle;
    //Resolver
    let optimismResolver: OptimismResolver;
    let BedrockProofVerifier: BedrockProofVerifier;
    //Gateway
    let ccipApp;

    //0x8111DfD23B99233a7ae871b7c09cCF0722847d89
    const alice = new ethers.Wallet("0xfd9f3842a10eb01ccf3109d4bd1c4b165721bf8c26db5db7570c146f9fad6014");

    beforeEach(async () => {
        const l1Provider = new ethers.providers.StaticJsonRpcProvider("http://localhost:8545");
        const l2Provider = new ethers.providers.StaticJsonRpcProvider("http://localhost:9545");
        [owner] = await hreEthers.getSigners();
        ensRegistry = await mockEnsRegistry(ethers.utils.namehash("alice.eth"), alice.address);

        const l2OutputOracleFactory = (await hreEthers.getContractFactory("L2OutputOracle")) as L2OutputOracle__factory;
        //See github.com/ethereum-optimism/optimism/op-bindings/predeploys/dev_addresses.go
        l2OutputOracle = l2OutputOracleFactory.attach("0x6900000000000000000000000000000000000000").connect(l1Provider);

        const BedrockProofVerifierFactory = await hreEthers.getContractFactory("BedrockProofVerifier");
        BedrockProofVerifier = (await BedrockProofVerifierFactory.deploy(l2OutputOracle.address)) as BedrockProofVerifier;

        const OptimismResolverFactory = await hreEthers.getContractFactory("OptimismResolver");
        optimismResolver = (await OptimismResolverFactory.deploy(
            "http://localhost:8080/{sender}/{data}",
            owner.address,
            BedrockProofVerifier.address,
            ensRegistry.address
        )) as OptimismResolver;

        ccipApp = express();
        ccipApp.use(bodyParser.json());
        ccipApp.use(ccipGateway(l1Provider, l2Provider));
    });

    describe("resolve", () => {
        it("ccip gateway resolves existing profile using ethers.provider.getText()", async () => {
            const provider = new MockProvider(hreEthers.provider, fetchRecordFromCcipGateway, optimismResolver);

            const resolver = await provider.getResolver("alice.eth");

            const text = await resolver.getText("network.dm3.eth");
            const profile = {
                publicSigningKey: "0ekgI3CBw2iXNXudRdBQHiOaMpG9bvq9Jse26dButug=",
                publicEncryptionKey: "Vrd/eTAk/jZb/w5L408yDjOO5upNFDGdt0lyWRjfBEk=",
                deliveryServices: ["foo.dm3"],
            };

            expect(text).to.eql(JSON.stringify(profile));
        });
        it("ccip gateway resolves existing profile using ethers.provider.getAddress()", async () => {
            const provider = new MockProvider(hreEthers.provider, fetchRecordFromCcipGateway, optimismResolver);

            const resolver = await provider.getResolver("alice.eth");

            const addr = await resolver.getAddress();

            expect(addr).to.equal(alice.address);
        });

        it("Returns empty string if record is empty", async () => {
            const provider = new MockProvider(hreEthers.provider, fetchRecordFromCcipGateway, optimismResolver);

            const resolver = await provider.getResolver("foo.dm3.eth");
            const text = await resolver.getText("unknown record");

            expect(text).to.be.null;
        });
    });

    describe("resolveWithProof", () => {
        it("proof is valid onchain", async () => {
            const { callData, sender } = await getGateWayUrl("alice.eth", "network.dm3.eth", optimismResolver);
            const { body, status } = await request(ccipApp).get(`/${sender}/${callData}`).send();

            const responseBytes = await optimismResolver.resolveWithProof(body.data, callData);
            const responseString = Buffer.from(responseBytes.slice(2), "hex").toString();

            const profile = {
                publicSigningKey: "0ekgI3CBw2iXNXudRdBQHiOaMpG9bvq9Jse26dButug=",
                publicEncryptionKey: "Vrd/eTAk/jZb/w5L408yDjOO5upNFDGdt0lyWRjfBEk=",
                deliveryServices: ["foo.dm3"],
            };
            expect(responseString).to.eql(JSON.stringify(profile));
        });
    });

    const fetchRecordFromCcipGateway = async (url: string, json?: string) => {
        const [sender, data] = url.split("/").slice(3);
        const response = await request(ccipApp).get(`/${sender}/${data}`).send();
        return response;
    };
});