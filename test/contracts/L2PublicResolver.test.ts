import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers.js";
import { ethers } from "hardhat";

import { L2PublicResolver } from "typechain";

import { expect } from "chai";
import { BigNumber } from "ethers";
import { dnsEncode, keccak256, toUtf8Bytes } from "ethers/lib/utils";
import { dnsWireFormat } from "../helper/encodednsWireFormat";

import { formatsByCoinType } from "@ensdomains/address-encoder";

describe("L2PublicResolver", () => {
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;
    let l2PublicResolver: L2PublicResolver;

    beforeEach(async () => {
        [user1, user2] = await ethers.getSigners();
        const l2PublicResolverFactory = await ethers.getContractFactory("L2PublicResolver");
        l2PublicResolver = (await l2PublicResolverFactory.deploy({
            gasLimit: 30000000,
        })) as L2PublicResolver;
    });

    describe("Clear records", async () => {
        it("can clear records", async () => {
            console.log("addr", user1.address);
            const name = "dm3.eth";
            const node = ethers.utils.namehash("dm3.eth");
            // record should initially be empty
            expect(BigNumber.from(await l2PublicResolver.recordVersions(user1.address, node)).toNumber()).to.equal(0);

            const tx = await l2PublicResolver.connect(user1).clearRecords(dnsEncode(name));
            const receipt = await tx.wait();

            const [textChangedEvent] = receipt.events;

            const [context, eventName, eventNode, recordVersion] = textChangedEvent.args;

            expect(ethers.utils.getAddress(context)).to.equal(user1.address);

            expect(eventName).to.equal(dnsEncode(name));
            expect(eventNode).to.equal(node);
            expect(recordVersion.toNumber()).to.equal(1);

            // record of the owned node should be changed
            expect((await l2PublicResolver.recordVersions(user1.address, node)).toNumber()).to.equal(1);
        });
    });

    describe("TextResolver", () => {
        it("set text record on L2", async () => {
            const name = "dm3.eth";
            const node = ethers.utils.namehash("dm3.eth");
            // record should initially be empty
            expect(await l2PublicResolver.text(user1.address, node, "network.dm3.profile")).to.equal("");

            const tx = await l2PublicResolver.connect(user1).setText(dnsEncode(name), "network.dm3.profile", "test");
            const receipt = await tx.wait();

            const [textChangedEvent] = receipt.events;

            const [context, eventName, eventNode, _, eventKey, eventValue] = textChangedEvent.args;

            expect(ethers.utils.getAddress(context)).to.equal(user1.address);
            expect(eventNode).to.equal(node);
            expect(eventName).to.equal(dnsEncode(name));
            expect(eventKey).to.equal("network.dm3.profile");
            expect(eventValue).to.equal("test");

            // record of the owned node should be changed
            expect(await l2PublicResolver.text(user1.address, node, "network.dm3.profile")).to.equal("test");
        });
        it("delegate can set text record context if approved", async () => {
            const name = "subname.parent.eth";
            const node = ethers.utils.namehash(name);
            const context = user1.address;
            const record = "test";
            const value = "my-delegated-value";
            try {
                await l2PublicResolver.connect(user2).setTextFor(context, dnsEncode(name), record, "test");
            } catch (e) {
                expect(e.message).to.include("Not authorised");
            }
            // record should be empty
            expect(await l2PublicResolver.text(context, node, record)).to.equal("");
            const tx0 = await l2PublicResolver.connect(user1)["approve(bytes,address,bool)"](dnsEncode(name), user2.address, true);
            await tx0.wait();
            const tx = await l2PublicResolver.connect(user2).setTextFor(context, dnsEncode(name), record, value);
            const receipt = await tx.wait();
            const [addressChangedEvent] = receipt.events;
            const [eventContext] = addressChangedEvent.args;

            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(await l2PublicResolver.text(user1.address, node, record)).to.equal(value);
        });
    });

    describe("AddrResolver", () => {
        it("set addr record on L2", async () => {
            const name = "a.b.c.d.dm3.eth";
            const node = ethers.utils.namehash(name);

            // record should initially be empty
            expect(await l2PublicResolver["addr(bytes,bytes32)"](user1.address, node)).to.equal(
                "0x0000000000000000000000000000000000000000"
            );
            const tx = await l2PublicResolver["setAddr(bytes,address)"](dnsEncode(name), user2.address);
            const receipt = await tx.wait();
            const [addressChangedEvent, addrChangedEvent] = receipt.events;

            let [eventContext, eventName, eventNode, eventCoinType, eventAddress] = addressChangedEvent.args;

            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(eventNode).to.equal(node);
            expect(eventName).to.equal(dnsEncode(name));
            expect(eventCoinType.toNumber()).to.equal(60);
            expect(ethers.utils.getAddress(eventAddress)).to.equal(user2.address);

            [eventContext, eventName, eventNode, eventAddress] = addrChangedEvent.args;

            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(eventNode).to.equal(node);
            expect(eventName).to.equal(dnsEncode(name));
            expect(ethers.utils.getAddress(eventAddress)).to.equal(user2.address);
            // record of the owned node should be changed
            expect(await l2PublicResolver["addr(bytes,bytes32)"](user1.address, node)).to.equal(user2.address);
        });
        it("set blockchain address record on L2", async () => {
            const name = "btc.dm3.eth";
            const node = ethers.utils.namehash(name);

            const btcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
            const btcCoinType = 0;
            //See https://github.com/ensdomains/ensjs-v3/blob/c93759f1197e63ca98006f6ef8edada5c4a332f7/packages/ensjs/src/utils/recordHelpers.ts#L43
            const cointypeInstance = formatsByCoinType[btcCoinType];
            const decodedBtcAddress = cointypeInstance.decoder(btcAddress);

            // record should initially be empty
            expect(await l2PublicResolver["addr(bytes,bytes32)"](user1.address, node)).to.equal(
                "0x0000000000000000000000000000000000000000"
            );
            const tx = await l2PublicResolver["setAddr(bytes,uint256,bytes)"](dnsEncode(name), btcCoinType, decodedBtcAddress);
            const receipt = await tx.wait();
            const [addressChangedEvent] = receipt.events;

            let [eventContext, eventName, eventNode, eventCoinType, eventAddress] = addressChangedEvent.args;

            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(eventNode).to.equal(node);
            expect(eventName).to.equal(dnsEncode(name));
            expect(eventCoinType.toNumber()).to.equal(0);

            const result = await l2PublicResolver["addr(bytes,bytes32,uint256)"](user1.address, node, btcCoinType);
            console.log(result);

            const encodedBtcAddress = cointypeInstance.encoder(Buffer.from(result.slice(2), "hex"));

            expect(encodedBtcAddress).to.equal(btcAddress);
        });
        it("delegate can set addr record context if approved", async () => {
            const name = "subname.parent.eth";
            const node = ethers.utils.namehash(name);
            const context = user1.address;
            try {
                await l2PublicResolver.connect(user2)["setAddrFor(bytes,bytes,address)"](context, dnsEncode(name), user2.address);
            } catch (e) {
                expect(e.message).to.include("Not authorised");
            }
            // record should be empty
            expect(await l2PublicResolver["addr(bytes,bytes32)"](context, node)).to.equal("0x0000000000000000000000000000000000000000");
            const tx0 = await l2PublicResolver.connect(user1)["approve(bytes,address,bool)"](dnsEncode(name), user2.address, true);
            await tx0.wait();
            const tx = await l2PublicResolver.connect(user2)["setAddrFor(bytes,bytes,address)"](context, dnsEncode(name), user2.address);
            const receipt = await tx.wait();
            const [addressChangedEvent] = receipt.events;
            let [eventContext] = addressChangedEvent.args;
            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(await l2PublicResolver["addr(bytes,bytes32)"](user1.address, node)).to.equal(user2.address);
        });
    });


    describe("ContentHash", () => {
        it("set contentHash on L2", async () => {
            const name = "dm3.eth";
            const node = ethers.utils.namehash(name);

            const contentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));
            const tx = await l2PublicResolver.connect(user1).setContenthash(dnsEncode(name), contentHash);

            const receipt = await tx.wait();
            const [contentHashChangedEvent] = receipt.events;

            const [eventContext, eventName, eventNode, eventHash] = contentHashChangedEvent.args;

            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(eventName).to.equal(dnsEncode(name));
            expect(eventNode).to.equal(node);
            expect(eventHash).to.equal(eventHash);

            const actualContentHash = await l2PublicResolver.contenthash(user1.address, node);

            expect(actualContentHash).to.equal(contentHash);
        });
        it("delegate can set contentHash record context if approved", async () => {
            const name = "subname.parent.eth";
            const node = ethers.utils.namehash(name);
            const context = user1.address;
            const contentHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));
            try {
                await l2PublicResolver.connect(user2).setContenthashFor(context, dnsEncode(name), contentHash);
            } catch (e) {
                expect(e.message).to.include("Not authorised");
            }
            // record should be empty
            expect(await l2PublicResolver.contenthash(context, node)).to.equal("0x");
            const tx0 = await l2PublicResolver.connect(user1)["approve(bytes,address,bool)"](dnsEncode(name), user2.address, true);
            await tx0.wait();
            const tx = await l2PublicResolver.connect(user2).setContenthashFor(context, dnsEncode(name), contentHash);
            const receipt = await tx.wait();
            const [addressChangedEvent] = receipt.events;
            const [eventContext] = addressChangedEvent.args;

            expect(ethers.utils.getAddress(eventContext)).to.equal(user1.address);
            expect(await l2PublicResolver.contenthash(user1.address, node)).to.equal(contentHash);
        });
    });
  ;
});
