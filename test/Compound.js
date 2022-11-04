const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Compound", function () {
    const MINT_AMOUNT = 100n * 10n ** 18n;
    let owner, signer1
    let erc20A, cErc20A, comptroller, simplePriceOracle, interestRateModel

    it("get signers", async function () {
        [owner, signer1] = await ethers.getSigners();
    })

    describe("deploy", async () => {
        it("deploy erc20A", async function () {
            const erc20Factory = await ethers.getContractFactory("TestERC20");
            erc20A = await erc20Factory.deploy(
                "TokenA",
                "ATK",
                ethers.utils.parseUnits("1000000", 18)
            );
            await erc20A.deployed();
        })

        it("deploy comptroller", async function () {
            const comptrollerFactory = await ethers.getContractFactory("Comptroller");
            comptroller = await comptrollerFactory.deploy();
            await comptroller.deployed();
        })

        it("deploy simplePriceOracle", async function () {
            const priceOracleFactory = await ethers.getContractFactory("SimplePriceOracle");
            simplePriceOracle = await priceOracleFactory.deploy();
            await simplePriceOracle.deployed();
        })

        it("deploy interest rate model", async function () {
            const interestRateModelFactory = await ethers.getContractFactory("WhitePaperInterestRateModel");
            interestRateModel = await interestRateModelFactory.deploy(
                ethers.utils.parseUnits("0", 18),
                ethers.utils.parseUnits("0", 18),
            );
            await interestRateModel.deployed();
        })

        it("deploy cErc20A", async function () {
            const cErc20Factory = await ethers.getContractFactory("CErc20Immutable");
            cErc20A = await cErc20Factory.deploy(
                erc20A.address,
                comptroller.address,
                interestRateModel.address,
                ethers.utils.parseUnits("1", 18),
                "Test Token",
                "TTK",
                18,
                owner.address,
            );
            await cErc20A.deployed();
        })
    })

    describe("Settings", async () => {
        it("setup SimplePriceOracle to Comptroller", async function () {
            await comptroller._setPriceOracle(simplePriceOracle.address);
        })

        it("setup supportMarket to Comptroller", async function () {
            await comptroller._supportMarket(cErc20A.address);
        })
    })

    describe("Test mint and redeem", async () => {
        it("Test mint", async function () {
            // approve cErc20A address and mint
            await erc20A.approve(cErc20A.address, MINT_AMOUNT);
            await cErc20A.mint(MINT_AMOUNT);

            // cErc20's erc20A increase
            expect(await erc20A.balanceOf(cErc20A.address)).to.equal(MINT_AMOUNT);

            // owner's cErc20A increase
            expect(await cErc20A.balanceOf(owner.address)).to.equal(MINT_AMOUNT);
        });

        it("Test redeem", async function () {
            // redeem
            await cErc20A.redeem(MINT_AMOUNT);

            // cErc20's erc20A decrease
            expect(await erc20A.balanceOf(cErc20A.address)).to.equal(0);

            // owner's cErc20A decrease
            expect(await cErc20A.balanceOf(owner.address)).to.equal(0);
        });
    })

});