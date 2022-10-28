const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Compound", function () {
    const MINT_AMOUNT = 100n * 10n ** 18n;

    it("Test", async function () {
        // get admin address
        const [owner, otherAccount] = await ethers.getSigners();

        // deploy underlying asset
        const erc20Factory = await ethers.getContractFactory("TestERC20");
        const testErc20 = await erc20Factory.deploy(ethers.utils.parseUnits("1000000", 18));
        await testErc20.deployed();

        // deploy comptroller
        const comptrollerFactory = await ethers.getContractFactory("Comptroller");
        const comptroller = await comptrollerFactory.deploy();
        await comptroller.deployed();

        // deploy priceOracle
        const priceOracleFactory = await ethers.getContractFactory("SimplePriceOracle");
        const simplePriceOracle = await priceOracleFactory.deploy();
        await simplePriceOracle.deployed();

        // setup SimplePriceOracle to Comptroller
        comptroller._setPriceOracle(simplePriceOracle.address);

        // deploy interest rate model
        const interestRateFactory = await ethers.getContractFactory("WhitePaperInterestRateModel");
        const interestRate = await interestRateFactory.deploy(
            ethers.utils.parseUnits("0", 18),
            ethers.utils.parseUnits("0", 18),
        );
        await interestRate.deployed();

        // deploy cErc20
        const cErc20Factory = await ethers.getContractFactory("CErc20Immutable");
        const cErc20 = await cErc20Factory.deploy(
            testErc20.address,
            comptroller.address,
            interestRate.address,
            ethers.utils.parseUnits("1", 18),
            "Test Token",
            "TTK",
            18,
            owner.address,
        );
        await cErc20.deployed();

        // setup supportMarket to Comptroller
        comptroller._supportMarket(cErc20.address);



        // test mint
        await testErc20.approve(cErc20.address, MINT_AMOUNT);
        await cErc20.mint(MINT_AMOUNT);

        // cErc20's testErc20 increase
        expect(await testErc20.balanceOf(cErc20.address)).to.equal(MINT_AMOUNT);

        // owner's cErc20 increase
        expect(await cErc20.balanceOf(owner.address)).to.equal(MINT_AMOUNT);



        // test redeem
        await cErc20.approve(owner.address, MINT_AMOUNT);
        await cErc20.redeem(MINT_AMOUNT);

        // cErc20's testErc20 decrease
        expect(await testErc20.balanceOf(cErc20.address)).to.equal(0);

        // owner's cErc20 decrease
        expect(await cErc20.balanceOf(owner.address)).to.equal(0);

        // changeTokenBalances : do research
    });
});